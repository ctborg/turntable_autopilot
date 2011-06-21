// Turntable Autopilot Chrome Extension
// See https://github.com/onilabs/turntable_autopilot
//

//----------------------------------------------------------------------
// Turntable API

var TT = {};

TT.log = function() {};
// uncomment for debugging
var c = require('apollo:debug').console(); TT.log = function(m) { c.log(m);};
//turntable.eventListeners.message.unshift(function(m) { c.log(m); });
turntable.eventListeners.soundstart.unshift(function(m) { c.log('playing:'+m.sID); });


// make an API request; wait for reply
TT.request = function(message) {
  waitfor(var rv) { turntable.sendMessage(message, resume); }
  return rv;
};

// wait for a particular event
TT.waitforEvent = function(event, filter) {
  waitfor(var rv) {
    function handler(message) { if (!filter || filter(message)) resume(message); }
    // there is a bug in turntable.dispatchEvent (missing 'var'!!) which means that
    // messages can get overwritten by event handlers. To avoid that, we insert at the
    // beginning of the array:
    turntable.eventListeners[event].unshift(handler);
  }
  finally { turntable.removeEventListener(event, handler); }
  return rv;
};

// wait until a particular command message is received
TT.waitforMessage = function(command) { 
  return TT.waitforEvent('message', function(m) { return m.command == command; });
};

// grab a dj slot (waiting until one becomes available)
TT.grabNextDJSlot = function() {
  while (!turntable.topViewController.isDj()) {
    // wait until slot available:
    while (turntable.topViewController.djIds.length >= 
           turntable.topViewController.maxDjs) {
      TT.waitforMessage("rem_dj");
      // give state change a chance to filter through to turntable ui:
      hold(0);
    }
    // try to grab slot:
    TT.request({api:"room.add_dj", roomid: turntable.topViewController.roomId});
  }
};

// get the current song 
TT.getCurrentSong = function() {
  return turntable.topViewController.currentSong;
};

// is my song currently playing?
TT.mySongPlaying = function() {
  return turntable.topViewController.currentDj == turntable.user.id;
};

// wait until next song is playing
// whos = 'mine'|'others'|'anyones' (default: 'anyones')
TT.waitforNextSong = function(whos) {
  TT.waitforEvent("soundstart", function(m) {
    if (m.sID.indexOf("_") == -1 || 
        m.sID.indexOf("preview") != -1)
      return false; // not a dj'ed song (a preview or something)
    if (whos == 'mine') return TT.mySongPlaying();
    if (whos == 'others') return !TT.mySongPlaying();
    return true; // anyones
  });
  return TT.getCurrentSong();
}

// upvote the current song
TT.upvote = function() {
  if (TT.mySongPlaying()) return; // can't upvote self
  TT.request({api:"room.vote", 
              roomid: turntable.topViewController.roomId, 
              val: "up", 
              vh:$.sha1(turntable.topViewController.roomId + "up" + turntable.topViewController.currentSong._id), 
              th:$.sha1(Math.random() + ""), 
              ph:$.sha1(Math.random() + "")});
};

//----------------------------------------------------------------------
// Last.fm API 

var lastFMKey = "b25b959554ed76058ac220b7b2e0a026"; // XXX don't use demo key
var lastFMApi = "http://ws.audioscrobbler.com/2.0/";

// get similar tracks to the current artist:track from Last.fm
TT.getSimilarLastFmTracks = function(artist, track) {
  var rv = require('apollo:http').jsonp(
    [lastFMApi,
     {
       api_key: lastFMKey,
       format: "json",
       method: "track.getsimilar",
       artist: artist,
       track: track,
       autocorrect: 1,
       limit: 20
     }
    ]);
  if (!rv || !rv.similartracks || !rv.similartracks.track ||
      typeof rv.similartracks.track == "string") 
    return null;
  TT.log('getSimilarLastFmTracks successful');
  return rv.similartracks.track;
}

// get top tracks for the given artist
TT.getTopLastFmArtistTracks = function(artist) {
  var rv = require('apollo:http').jsonp(
    [lastFMApi,
     {
       api_key: lastFMKey,
       format: "json",
       method: "artist.getTopTracks",
       artist: artist,
       autocorrect: 1,
       limit: 20
     }
    ]);
  if (!rv || !rv.toptracks || !rv.toptracks.track ||
      typeof rv.toptracks.track == "string") 
    return null;
  TT.log('getTopLastFmArtistTracks successful');
  return rv.toptracks.track;
};

//----------------------------------------------------------------------

// continually upvote
TT.autoUpvoteLoop = function() {
  while(1) {
    try { TT.upvote(); } catch(e) { /* ignore */ }
    TT.waitforNextSong('others');
    // give turntable a chance to register song
    hold(1000);
  }
};

// skip my song after a certain time
TT.autoSkipLoop = function(t) {
  while(1) {
    TT.waitforNextSong('mine');
    waitfor {
      hold(t);     
      TT.request({api:"room.stop_song", 
                  roomid:  turntable.topViewController.roomId});
    }
    or {
      TT.waitforEvent("soundfinish");
    }
  }
};

// whenever someone plays a song, try to add a similar song to our playlist:
TT.fillPlaylistLoop = function() {
  var song = ((!TT.mySongPlaying() && TT.getCurrentSong()) || 
              TT.waitforNextSong('others')).metadata;
  while (1) {
    TT.log(song.artist+ " -- " + song.song);
    // we try similar tracks first; then top tracks by the given artist:
    var similar = TT.getSimilarLastFmTracks(song.artist,song.song) || 
      TT.getTopLastFmArtistTracks(song.artist);
    if (similar) {
      TT.log(similar);
      // Ok, got a list of similar tracks; now go through the list randomly and see
      // if we can find one on turntable.fm:
      while (similar.length) {
        var track = similar.splice(Math.floor(similar.length*Math.random()), 1)[0];
        TT.log("Similar:"+track.artist.name+": "+track.name);
        
        // search for the track on turntable:
        TT.request({api:'file.search',query:track.artist.name+" "+track.name});
        var found = TT.waitforMessage('search_complete');
        if (!found || !found.docs || !found.docs.length) {
          TT.log('not found on tt');
          // try next one
          continue;
        }
        // ok, we found the track on turntable; add it to the top of the playlist
        found = found.docs[0];
        TT.log(found);
        turntable.playlist.addSong({fileId: found._id, metadata: found.metadata},0);
        break;
      }
    }
    else
      TT.log("Error getting similar tracks");

    // wait for next song:
    song = TT.waitforNextSong('others').metadata;
  }
}

//----------------------------------------------------------------------
// Main 

// wait until we're registered:
TT.waitforMessage("registered");

// insert our ui:
var menubutton = document.createElement('div');
menubutton.setAttribute('class', 'menuItem');
var menu = document.getElementById('menuh');
menu.insertBefore(menubutton, menu.firstChild.nextSibling);

// top-level loop:
while (1) {
  menubutton.textContent="Start Autopilot";
  require('apollo:dom').waitforEvent(menubutton, 'click');
  menubutton.textContent="Stop Autopilot";
  waitfor {
    autopilotLoop();
  }
  or {
    require('apollo:dom').waitforEvent(menubutton, 'click');
  }
}

function autopilotLoop() {
  waitfor {
    while (1) {
      waitfor {
        TT.grabNextDJSlot();
        hold();
      }
      or {
        TT.waitforMessage("registered");
        // we entered a new room; go round loop again to grab sj slot when avail
      }
    }
  }
  and {
    // automatically upvote other djs. we're no hater.
    TT.autoUpvoteLoop();
  }
  and {
    TT.fillPlaylistLoop();
  }
}
