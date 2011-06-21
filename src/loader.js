// inject autopilot.sjs and oni-apollo.js directly into the page; not into sandbox
var url = chrome.extension.getURL("autopilot.sjs");
chrome.extension.sendRequest({'action':'fetchResource', url:url}, function(txt) { 
  // inject sjs code
  var elem = document.createElement("script");
  document.getElementsByTagName("head")[0].appendChild(elem);
  elem.setAttribute("type", "text/sjs");
  elem.textContent = txt;
  // inject apollo runtime
  elem = document.createElement("script");
  document.getElementsByTagName("head")[0].appendChild(elem);
  elem.src = "http://code.onilabs.com/apollo/0.12/oni-apollo.js";
});
