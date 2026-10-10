# Laptop graphics and comfortable controls

The new **Laptop** graphics choice uses the existing lower-effect scene settings and a bounded picture size. It keeps a 60 FPS cap, reduces optional dust/light shafts, uses the smaller actor-contact budget and lowers texture filtering. This reduces rendering work; it does not promise a frame rate on an untested MacBook.

All graphics choices now limit the total number of rendered pixels as the window or display density changes. The menu and HUD remain native-resolution text. Existing saved choices remain selected, and the default is still Balanced. There is no hardware-name guessing or continuously fluctuating resolution system.

| Choice | Maximum rendered pixels | Maximum density | Frame cap |
| --- | ---: | ---: | ---: |
| Laptop | 1,250,000 | 1.0× | 60 |
| Performance | 1,500,000 | 1.0× | 60 |
| Balanced | 2,100,000 | 1.25× | 60 |
| Quality | 3,750,000 | 1.5× | 120 |

Resolution is the smallest of display density, preset density and the square root of the pixel budget divided by window area. Large windows can therefore render below one picture pixel per CSS pixel. Mobile retains its 30 FPS cap and a smaller one-million-pixel ceiling. Existing frame pacing is unchanged.

**Use comfort settings** explicitly enables reduced flashes, turns off weapon movement while walking and selects at least Large text. It preserves graphics, audio, sensitivity, field of view and game rules. Text size also has separate Standard, Large and Larger choices. Settings now use larger controls, clear focus outlines, a keyboard focus loop, Escape-to-close and focus restoration. The opaque settings panel avoids a costly background blur.

Crouch and sprint offer Hold or Toggle, and scroll-wheel weapon switching can be disabled. Existing settings records default these options to Hold, Hold and enabled. The main integration adds the keyboard fire option described in the controls documentation; this settings pass only stores and presents those choices.

## Verification

- `evidence/current-v1.8/v9-final/core/suite-summary.json`: **89/89 final gameplay checks passed**, zero browser errors, all six processes exited successfully and no source hashes changed during the run. Suites: QA 25, routes 4, extras 6, completion 19, melee 15 and zombies 20. The prior successful run, during which the final startup-message/panel changes landed, is retained as `core-before-final-ui`.

- `evidence/current-v1.8/v9-final/unit.log`: **314/314 unit tests passed**. Added coverage checks pixel budgets across 1280–6016-pixel-wide displays and densities from 0.75–3, resizing, invalid inputs, old preference migration and narrow comfort changes. Existing frame-pacing tests also pass.
- `evidence/current-v1.8/laptop-settings/report.json`: **8/8 actual Chrome checks passed**, with no browser errors. The browser used Retina density emulation on the current Mac, not a physical MacBook. Checks cover saved preferences, each relevant preset, actual lower-effect state, resizing, comfort, 390×640 settings at Larger text, persistence, defaults and play/pause.
- At a 1728×1117 CSS viewport with density 2, Balanced rendered **1802×1165 = 2,099,330 pixels**. Laptop rendered **1390×898 = 1,248,220 pixels**. Resizing to 2560×1440 stayed within Laptop's budget; resizing to 1280×800 restored a 1280×800 picture. These are measured buffer sizes, not performance scores.
- Screenshots `01-comfort-1280.png`, `02-larger-text-narrow.png`, `03-larger-text-narrow-bottom.png` and `04-larger-hud.png` in the same folder were visually reviewed for readable layout. The menu agent separately verifies the final opaque modal and navigation in `evidence/current-v1.8/v9-menu/report.json`.

Physical MacBook frame rate, battery consumption, screen-reader behavior and personal motion comfort remain unmeasured. No settings check changes game balance or certifies those properties.

## Files

`export/web/desktop-settings.js`, `export/web/desktop-settings.css`, new `export/web/display-performance.js`, `test/desktop-settings.test.mjs`, new `test/display-performance.test.mjs` and `.tools/test-laptop-settings.mjs`. The parent integration in `game.js` applies the display budget on startup, settings changes, resize and display-density changes, and forwards Laptop's lower-effect quality to the existing render systems.
