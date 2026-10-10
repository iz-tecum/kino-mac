KINO DER TOTEN 1.8

Play on your MacBook
1. Copy Kino-1.8-Universal-Mac.zip to the MacBook and unzip it.
2. Move Kino der Toten.app into Applications and open it.
3. Select Play. No separate game engine or download is needed.

The same app contains Intel and Apple Silicon versions. It requires macOS
Ventura 13 or newer and WebGL 2-capable graphics. Check macOS in Apple menu >
About This Mac if needed. Your particular MacBook has not been tested.
Apple Silicon launch and play passed on this iMac. The Intel executable is
included, but its translated test did not finish loading within two minutes;
Intel gameplay and the target MacBook remain unverified.
The app is locally signed, not Apple-notarized.

For a laptop, start with Settings > Graphics > Laptop. It limits the 3D picture
size and optional effects; menu and HUD text stay sharp. Balanced remains the
default and existing choices are preserved. The “Use comfort settings” button enables fewer
flashes, disables walking weapon movement, and enlarges text. You can adjust
text size, brightness, look sensitivity, aimed sensitivity, field of view and
separate sound volumes yourself.

Controls
WASD move; mouse or trackpad look; Q toggle aim; right mouse hold aim.
Left mouse or Z fire. Z lets you look with the trackpad without clicking it.
R reload; F/E use or hold to repair; V knife; Space jump.
Shift sprint; C or Control crouch. Hold/Toggle choices are in Settings.
1/2 switch weapons; wheel also switches unless disabled in Settings.
G grenade; 4 Claymore; X Monkey Bomb; 5 upgraded attachment.
Escape pauses; M mutes; Control+Command+F toggles fullscreen.
Menus support Tab, Shift+Tab, Space/Enter and Escape in Settings.

What's new
- Simple Play, Resume and Settings screens, with short controls.
- Intel + Apple Silicon in one portable app.
- Laptop graphics preset; bounded resolution on Retina and external displays.
- Z fire, toggle sprint/crouch, optional wheel switching.
- Larger text and a one-click comfort preset.
- Fixed menu keys being intercepted by gameplay.
- Native sleep/lock notifications pause the run; wake leaves it paused.
- Window size fits the available desktop; graphics startup failures show Retry.
- Local file loading uses a bounded connection pool for reliable startup.

The Classic four-perk solo map, native models, lighting, sounds and previous
Pack-a-Punch fixes remain. This is still a fan reconstruction, not the original
T5 engine. Exact missing recordings and ambient events remain documented in
the historical v1.7 notes included with source. No co-op, gamepad or saved runs.
Settings and records persist; quitting ends an unfinished run.

Source
Kino-1.8-Source.zip contains the complete editable project, original uploaded
archive, prior patches, both pinned desktop runtimes and current evidence.
For source play with Node.js 24+, run inside project:
node .tools/serve.mjs 5173
Then open http://127.0.0.1:5173/ in Chrome. No npm installation needed to play.
BUILD-AND-EDIT.txt covers tests and rebuilding the Universal Mac app.

Verification scope
Read VERIFICATION.txt for exact checks and measured hardware. Retina display
emulation, keyboard automation and translated Intel execution are distinct
from physical MacBook, Intel GPU, trackpad, lid-close, battery and speaker tests.
