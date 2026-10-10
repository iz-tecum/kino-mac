# MacBook portability audit — v1.8

Audit date: 10 October 2026. This review does not infer the user's MacBook processor, OS version, memory, display or graphics capabilities. It separates runtime compatibility, source review, local execution and testing on the target MacBook. Runtime edits belong to the parent task; this audit added only release tooling and evidence.

## Confirmed starting package

The installed v1.7 `/Applications/Kino der Toten.app` was inspected directly. Its main executable, Electron Framework and renderer helper are `arm64`. Both Info.plist and native `LC_BUILD_VERSION` require macOS **13.0**. The app is locally ad-hoc signed, with no Developer ID team. No `.node` native add-ons exist in its application payload. The game uses the bundled browser, JavaScript and portable WebAssembly; there is no separately installed engine dependency.

Consequently, the existing ARM64 app cannot be described as compatible with an unspecified MacBook. Apple Silicon plus macOS 13 or later matches its architecture/OS requirements; Intel needs an x86_64 runtime. This is a launch prerequisite, not a frame-rate guarantee.

Electron's current official documentation explicitly places Electron 44 and later on macOS 13 Ventura or later. Older Monterey support cannot be restored by lowering `LSMinimumSystemVersion`; the native executables also require 13.0. See [Electron 44 release notes](https://www.electronjs.org/blog/electron-44-0) and [the breaking-change record](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support).

## Universal release route

The official [Electron 44.7.0 release](https://github.com/electron/electron/releases/tag/v44.7.0), published 7 October 2026, supplies both macOS architectures. The fetched Intel ZIP is 134,289,782 bytes and its complete SHA-256 matches the official `SHASUMS256.txt`:

`4fe494a7159b10a81e2098dab388719582065e99e604c4510bb117e282213566`

The preserved ARM64 ZIP checksum is:

`e04e411b58a0a14375dd21b0ab4a378fd38930a702e4e20e322fee4849404c0b`

Intel archive, checksums and provenance are in `work/desktop-runtime-x64`. Neither runtime was rebuilt from source. The official main/framework/renderer Info.plists match between these two releases.

[@electron/universal](https://packages.electronjs.org/universal/v3.0.6/index.html) is designed to merge two architecture-specific Electron apps. Version **3.0.6** is pinned in `work/universal-packaging/package.json` and its lockfile. Installation disabled every lifecycle script; `lifecycle-review.json` records the reviewed declarations. Pinned npm 12.2.0 was bootstrapped locally because this workspace's Node installation did not include npm; its tarball integrity and provenance were recorded, and no install lifecycle scripts were enabled. This tooling is not part of the shipped game.

The merger accepts:

```sh
node work/universal-packaging/merge-macos.mjs \
  --x64 /absolute/path/Intel.app \
  --arm64 /absolute/path/AppleSilicon.app \
  --output /absolute/path/NewUniversal.app \
  --report /absolute/path/new-universal-report.json
```

It refuses existing output paths, preserves both inputs, compares every application payload file, combines architecture provenance in temporary copies, removes obsolete signature directories, merges native code, verifies both slices in every Mach-O, checks deployment minima and both architecture-specific V8 snapshot hashes, and hashes the unchanged application tree. It deliberately does not silently accept different game builds or architecture-specific game copies. The merged app must be signed again, checked with strict deep verification, archived outside iCloud/File Provider folders, and verified again after ZIP extraction. Universal binaries contain both architecture slices; they do not validate both devices by themselves. See [Apple's universal-binary guidance](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary).

The parent's packager now accepts both runtime architectures and includes architecture in its extraction-cache name. This avoids accidentally reusing an ARM64 extraction for an Intel build. The game identifier, `kino://game` origin and persistent session stay the same so normal upgrades preserve settings and best-round records.

A packaging fixture using both complete official runtimes and a two-file placeholder application passed the merger: all **13 native files** contain both architectures, all **26 slices** require macOS 13.0, and both V8 snapshots retain their source hashes. Evidence: `work/universal-packaging/fixture-report.json`. This tests the merger and native runtime layout; its placeholder application is not full-game evidence. An initial verification attempt exposed a `/var` versus `/private/var` canonical-path mismatch; the path check was corrected and the full fixture merge reran successfully.

## Verified local Intel execution and limits

The existing Rosetta installation can run an x86_64 system executable. A direct `Electron --version` probe timed out after 20 seconds and was not counted as success; it left no matching probe process. A subsequent isolated `ELECTRON_RUN_AS_NODE=1` execution of the verified Intel Electron returned exit 0 with:

```json
{"arch":"x64","electron":"44.7.0","node":"24.21.0"}
```

This proves Intel runtime execution under Rosetta on this Apple Silicon Mac. It does **not** prove native Intel GPU behavior, a full Intel game launch, or operation on the user's MacBook. No Rosetta installation or system network change was performed. Final universal game launch evidence belongs to the release verification report.

The signed ZIP-extracted universal app subsequently passed the same forced-x64 Node-mode probe in **4.53 seconds** (`work/universal-packaging/final-intel-node-probe.json`). Its first full-game Playwright attempt timed out at the default 30-second launch-connection boundary, before test assertions or readiness checks. That timeout is preserved as an unsuccessful attempt; it is not a gameplay pass or proof of native Intel incompatibility. A diagnostic checker copy raises only that connection allowance to 90 seconds, retains every architecture/gameplay/security assertion, and enables launch-process logs.

Those logs established that the launcher works: the main inspector connected in 0.99 seconds and Chromium in 3.39 seconds. A macOS process sample independently identified the renderer as `X86-64 (translated)`. However, that run failed on `kino://game/kino.gltf` with `net::ERR_UNEXPECTED` and an underlying loopback `read ECONNRESET`. The file is 1,803,539 bytes, not a large binary buffer. An isolated fetch using the same packaged x64 runtime and server succeeded in 1.38 seconds and matched its disk SHA-256 exactly. The report is `work/packaged-v9-intel-check-final/report.json`; the log is `work/packaged-v9-intel-diagnostic.log`.

A clean unchanged-package retry progressed to 577 requests but recorded **242 failed local texture requests**, accompanied by `connect ETIMEDOUT` to its private loopback server. It never reached readiness, and was not counted as a pass. Evidence: `work/packaged-v9-intel-check-retry/report.json` and `work/packaged-v9-intel-retry.log`. The post-failure socket sample is explicitly not a peak connection count. These results support excessive simultaneous local connections as the practical failure mode; exact queue saturation was not directly measured. Both diagnostic applications closed, with no surviving test process.

The parent subsequently replaced the unrestricted fetch transport with `http.request` and a shared keep-alive Agent limited to **12 total connections**, including during streamed-body consumption. The reviewed implementation retains abort handling, rejects redirects, checks the loopback destination and read-only method, retries one reset only before headers, and exposes HTTP/body failures. The parent reports nine wrapper tests passing, including an 80-transfer test that measures the 12-connection limit through body completion. The rebuilt candidate is identified as **r3**; the original and r2 candidates are superseded.

The signed, ZIP-extracted **r3** app was then forced to x64 with a fresh profile and all checker assertions retained. Its main inspector connected after **56.21 seconds**, and Chromium after **58.58 seconds**, inside the 90-second launch limit. It reached **42% — “Restoring theater materials and lighting”** but exceeded the separate **120-second readiness limit**. The canonical report records **695 requests, zero failed requests, zero console errors, zero HTTP errors and no external requests**; no gameplay assertions had yet run. The fresh profile was using **Balanced**: this checker applies its quality option only during performance testing, which was not requested. Evidence: `work/packaged-v9-r3-intel-check/report.json`, `work/packaged-v9-r3-intel-check.log`, and `work/universal-packaging/r3-intel-loading-state.json`.

At the last live observation the renderer used about 105% CPU and reported no game error. This stage includes asynchronous normal-map/light-field loading and static geometry preparation; the observation does **not** isolate one bottleneck, prove loading was complete, or show that extending the timeout would succeed. Resource Timing returned no entries for the custom protocol and was not used as a request count. The previous load-time reset/timeout failures were not reproduced in this run, but **full Intel game execution remains unverified**.

After the readiness timeout, the checker began quitting at 22:09:01 UTC. Pending loopback requests first logged `ECONNREFUSED` at 22:09:11 UTC, after shutdown began; these are separately identified shutdown errors. The renderer closed, but the main process did not complete quitting promptly, so the owned test main process was terminated to finish the report and release the native test slot. All test processes were confirmed closed. This early-loading quit issue does not establish behavior when quitting a fully loaded game; it remains a limitation of this failed Intel loading attempt.

## Current input and lifecycle review

Reviewed source hashes are recorded in `macbook-audit-source-hashes.json`; the following refers to the revised v1.8 source, not the old installed v1.7 app.

| Area | Source behavior and assessment |
| --- | --- |
| Trackpad-friendly actions | Q toggles aim; Z fires; C provides crouch without requiring Control-click. Mouse and keyboard firing share the same gameplay rules. Optional crouch/sprint toggles clear on pause, transport and downing. Real trackpad palm rejection or tap-drag behavior is still hardware-dependent. |
| Scroll gestures | `WheelIntent` ignores Control/Command-modified wheel events, predominantly horizontal movement and invalid deltas. It accumulates vertical intent and limits a burst to one switch; settings can disable wheel switching. Pinch is not interpreted as a weapon switch. |
| Keyboard focus | Gameplay keys reject inactive state, text composition, Command/Option shortcuts and focused form/button elements. Starting play blurs the menu control before acquiring pointer lock. Settings trap Tab focus, restore the prior focus and close on Escape. Keyup still releases held state. |
| Focus loss | Blur, pointer-lock loss and hidden-page transitions pause play and clear held movement, aim and firing. Resume requires the player to start again; Web Audio resumes from that action. |
| Sleep and lock | Main-process `powerMonitor` subscribes to `suspend`, `resume`, `lock-screen` and `unlock-screen` after app readiness. Close removes those exact listeners. It dispatches fixed local events, without granting renderer Node privileges. Renderer suspend stops animation and audio; resume resets pacing and leaves combat paused. Physical lid-close is not yet tested by this audit. |
| Window fit | Initial dimensions use the nearest display's work area, with room for the frame, Dock and menu bar. The minimum window is 720×480, down from 960×540. These are device-independent coordinates, not panel pixel dimensions. |
| Retina and external displays | Initial setup, settings changes and resize pass dimensions/DPR to the render-pixel budget. A resolution media-query listener updates DPR even when CSS size stays the same. Laptop uses a 1.25-million-pixel cap and reduced scene effects; this is a workload limit, not a promised FPS. |
| Rendering interruption | Hidden pages stop the animation loop. Visible menus run at 12 FPS. WebGL loss pauses, disables Play, and restoration recalculates display size and returns to paused state. The frame pacer caps simulation steps and does not replay an accumulated render burst. |
| Gamepads | No `getGamepads` or connection-handling implementation was found in the game source. `player-controller.js` is a movement/collision controller, not hardware gamepad support. Do not describe wireless controllers as tested or supported based on its name. |

These sleep/lock events are officially supported by [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor). Electron also documents that macOS occlusion can make a window hidden; leaving background throttling enabled is appropriate here. See [BrowserWindow page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility) and [screen coordinate/work-area documentation](https://www.electronjs.org/docs/latest/api/screen).

No additional blocking input defect was found in this static review. Physical trackpad, actual lid sleep/wake, Retina-to-external-display migration, native Intel graphics, Bluetooth devices and sustained battery/thermal performance remain separate acceptance items. The current renderer still requests a high-performance GPU for desktop play; the Laptop preset bounds rendering work but does not assert low-power GPU selection or battery-life improvement.

## Release and target-device checks

1. Inspect every native file for `arm64 x86_64`; retain both V8 snapshots and the unchanged application hash manifest. Sign the completed universal bundle and validate the ZIP-extracted copy.
2. Run the actual universal executable with an isolated verification profile. Confirm `process.arch`, local asset loading, rejected external fetch, Play/pointer lock, settings persistence, pause/resume, keyboard fire/aim, context recovery and quit cleanup. Force Intel execution under existing Rosetta as an additional path, clearly labelled as translated execution.
3. On the actual MacBook, record processor, macOS, logical display size/DPR and preset before claiming compatibility. Test native launch, trackpad look while moving/firing with Z, Q aim, Command-Tab, Escape, settings keyboard navigation, lid close/reopen and an ordinary combat round. Measure performance there; do not transfer iMac FPS claims.
4. Keep signing scope accurate. Local ad-hoc signing verifies bundle integrity but is not Developer ID signing or Apple notarization. A transferred/downloaded copy may face Gatekeeper checks. No publication, notarization submission, account use or security-policy change occurred. [Electron's signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing) explains the separate signing/notarization steps.
