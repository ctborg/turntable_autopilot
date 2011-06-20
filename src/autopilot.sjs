var c = require('apollo:debug').console();
turntable.eventListeners.message.unshift(function(m) { c.log(m.command); });
turntable.eventListeners.soundstart.unshift(function(m) { c.log(m); });
//----------------------------------------------------------------------
// Turntable API abstraction

var TT = {};

// make an API request; wait for reply
TT.request = function(message) {
  waitfor(var rv) {
    turntable.sendMessage(message, resume);
  }
  return rv;
};

// wait for a particular event
TT.waitforEvent = function(event, filter) {
  waitfor(var rv) {
    function handler(message) { 
      if (filter && !filter(message)) return;
      resume(message);
    }
    // there is a bug in turntable.dispatchEvent (missing 'var'!!) which means that
    // messages can get overwritten by event handlers. To avoid that, we insert at the
    // beginning of the array:
    turntable.eventListeners[event].unshift(handler);
  }
  finally { turntable.removeEventListener(event, handler); }
};

// wait until a particular command message is received
TT.waitforMessage = function(command) {
  waitfor(var rv) {
    function handler(message) { if (message.command == command) resume(message); }
    // there is a bug in turntable.dispatchEvent (missing 'var'!!) which means that
    // messages can get overwritten by event handlers. To avoid that, we insert at the
    // beginning of the array:
    turntable.eventListeners.message.unshift(handler);
  }
  finally { turntable.removeEventListener("message", handler); }
};

// grab a dj slot (waiting until one becomes available)
TT.grabNextDJSlot = function() {
  while (!turntable.topViewController.isDj()) {
    // wait until slot available:
    while (turntable.topViewController.djIds.length >= 
           turntable.topViewController.maxDjs)
      TT.waitforMessage("rem_dj");
    // try to grab it:
    TT.request({api:"room.add_dj", roomid: turntable.topViewController.roomId});
  }
};

// upvote the current song
TT.upvote = function() {
  TT.request({api:"room.vote", 
              roomid: turntable.topViewController.roomId, 
              val: "up", 
              vh:$.sha1(turntable.topViewController.roomId + "up" + turntable.topViewController.currentSong._id), 
              th:$.sha1(Math.random() + ""), 
              ph:$.sha1(Math.random() + "")});
};

// continually upvote
TT.autoUpvoteLoop = function() {
  while(1) {
    try { TT.upvote(); } catch(e) { /* ignore */ }
//    TT.waitforMessage("newsong");
    TT.waitforEvent("soundstart", function(m) { return m.sID.indexOf("_")!=-1; });
    // give turntable a chance to register song
    hold(1000);
  }
};

//----------------------------------------------------------------------
// Main 

TT.waitforMessage("registered");
TT.grabNextDJSlot();
TT.autoUpvoteLoop();