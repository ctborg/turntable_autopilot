Turntable.fm Autopilot Extension for Google Chrome
==================================================

You enable autopilot mode in [turntable.fm](http://turntable.fm/) by going to a room and clicking on 'Settings > Start Autopilot'.

Autopilot mode does the following:

- Automatically grabs any available DJ spot.
- Adds music to your playlist based on what others are playing (uses the last.fm api).
- Automatically upvotes songs played by others.

You can turn any of these actions on or off through 'Settings > Autopilot Settings'.

Settings are persisted throughout sessions.


Installation
------------

Either run as an unpacked chrome extension from src/, or install it from the Google Chrome Web Store, [here](https://chrome.google.com/webstore/detail/nnldmhlcgdkhgbnekldmppjoffikbclm).

Details
-------

For the main program logic, see src/autopilot.sjs ([Stratified JavaScript](http://onilabs.com/stratifiedjs) code).

Consider the code in the public domain. Happy hacking.
