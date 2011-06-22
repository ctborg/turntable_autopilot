// Turntable Autopilot Chrome Extension
// See https://github.com/onilabs/turntable_autopilot
// 
// The code in this file is *Stratified* JavaScript code; see
// http://onilabs.com/stratifiedjs

//----------------------------------------------------------------------
// Turntable API

var TT = {};

TT.log = function() {};
// uncomment for debugging
//var c = require('apollo:debug').console(); TT.log = function(m) { c.log(m);};
//turntable.eventListeners.message.unshift(function(m) { c.log(m); });
//turntable.eventListeners.soundstart.unshift(function(m) { c.log('playing:'+m.sID); });


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
// high-level helpers:

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
    var similar = null;
    waitfor {
      similar = TT.getSimilarLastFmTracks(song.artist,song.song) || 
        TT.getTopLastFmArtistTracks(song.artist);
    }
    or {
      hold(10000); // time out after 10s
      TT.log('timeout searching last.fm');
    }
    if (similar) {
      TT.log(similar);
      // Ok, got a list of similar tracks; now go through the list randomly and see
      // if we can find one on turntable.fm:
      while (similar.length) {
        var track = similar.splice(Math.floor(similar.length*Math.random()), 1)[0];
        TT.log("Similar: "+track.artist.name+": "+track.name);
        
        // search for the track on turntable:
        var found = null;
        waitfor {
          TT.request({api:'file.search',query:track.artist.name+" "+track.name});
          found = TT.waitforMessage('search_complete');
        }
        or {
          hold(10000); // time out after 10s
          TT.log('timeout searching for track on tt');
        }
        if (!found || !found.docs || !found.docs.length) {
          TT.log('not found on tt');
          // try next one
          continue;
        }
        // ok, we found the track on turntable; add it to the top of the playlist
        found = found.docs[0];
        TT.log("found on tt:"+found.metadata.song);
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

// combined upvoting, dj spot-grabbing, playlist filling:
function autopilotLoop(settings) {
  waitfor {
    if (settings.bools.autograb) {
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
  }
  and {
    // automatically upvote other djs. we're no haterz.
    if (settings.bools.autovote)
      TT.autoUpvoteLoop();
  }
  and {
    // automatically add songs similar to those being played
    if (settings.bools.autoqueue)
      TT.fillPlaylistLoop();
  }
}

//----------------------------------------------------------------------
// Settings UI

var localstorage_key = "onilabs-turntable-autopilot-settings";

try {
  var settings = JSON.parse(localStorage[localstorage_key]);
} catch(e) {/*ignore*/}

if (!settings || settings.schema != 1) 
  settings = {
    schema: 1,
    bools : {
      autograb: true,
      autoqueue: true,
      autovote: true
    }
  };

var ui = 
  ["div.settingsOverlay.modal",
   {}, ["div##cancel.close-x"],
   ["h1", "Autopilot Settings"],
   ["br"],
   ["div.field", {}, ["input##autograb", {type:"checkbox"} ],
    " Autograb next DJ spot" ],
   ["div.field", {}, ["input##autoqueue", {type:"checkbox"} ],
    " Add last.fm recommendations to playlist"],
   ["div.field", {}, ["input##autovote", {type:"checkbox"} ],
    " Vote up all DJs"],   
   ["div##ok.save-changes.centered-button"],
   ["br"]
  ];

// show settings overlay; return true if we need to reload
function doSettingsUI() {
  var v = {};
  turntable.showOverlay(util.buildTree(ui,v));
  for (var b in settings.bools) v[b].checked = settings.bools[b];
  waitfor {
    require('apollo:dom').waitforEvent(v.ok, 'click');
    for (var b in settings.bools) settings.bools[b] = v[b].checked;
    localStorage[localstorage_key] = JSON.stringify(settings);
    return true;
  }
  or {
    require('apollo:dom').waitforEvent(v.cancel, 'click');
    return false;
  }
  finally {
    turntable.hideOverlay();
  }
}

//----------------------------------------------------------------------
// Main 

try {
  // wait until we're registered:
  TT.waitforMessage("registered");

  // insert our ui:

  if (turntable.user.layouts.signedIn[0] != "div#menuh") 
    throw "Turntable UI not found."; // sanity check failed; tt probably updated their site

  turntable.user.layouts.signedIn.splice(
    3,0,
    ["div#toggleAutopilot.menuItem", {}, "Start autopilot"],
    ["div#configAutopilot.menuItem", {}, "Autopilot settings"]);

  turntable.user.updateDom();
  
  var toggleButton = document.getElementById('toggleAutopilot');
  var settingsButton = document.getElementById('configAutopilot');

  var running = false; // XXX persist this state?

  while (1) {
    waitfor {
      toggleButton.textContent = (running ? "Stop" : "Start") + " autopilot";
      require('apollo:dom').waitforEvent(toggleButton, 'click');
      running = !running;
    }
    or {
      while (1) {
        require('apollo:dom').waitforEvent(settingsButton, 'click');
        if (doSettingsUI())
          break; // reload autopilotLoop
      }
    }
    or {
      if (running) 
        autopilotLoop(settings);
      hold();
    }
  }
}
catch (e) {
  console.log('Turntable autopilot error: '+e);
  console.log('Please report issues to https://github.com/onilabs/turntable_autopilot/issues or alex@onilabs.com. Thanks!');
}
