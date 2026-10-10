# Kino der Toten for Mac

Public development and download repository for Kino 1.8. This repository contains the reconstructed game code, tests, native metadata, Mac launcher and build scripts. The complete playable game and the complete source archive, including media and runtime dependencies, are supplied as public release downloads.

## Play on a Mac

Download **Kino-1.8-Universal-Mac.zip** from the [1.8 release](https://github.com/iz-tecum/kino-mac/releases/tag/v1.8.0). Extract it locally, move **Kino der Toten.app** to Applications, and open it. Version 1.8 is a Universal app for Apple Silicon and Intel, requiring macOS 13 or newer. The package uses a local ad-hoc signature; it is not Apple-notarized. Do not overwrite a running copy with an unsaved round. For a laptop, select Settings > Graphics > Laptop.

If macOS shows an unknown-developer prompt, [Apple explains the local approval choice](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac). You must decide whether to approve it on that Mac.


Apple Silicon launch and play passed on the development iMac. The included Intel executable did not finish its translated loading test within two minutes; Intel gameplay remains unverified. MacBook hardware and its input devices must be checked on the actual destination. Testing on the development Mac does not establish destination-device performance.

## Continue development

The Git checkout is intentionally code-only: it omits roughly 2GB of media, collision meshes and runtime binaries. For a runnable workspace, download the two source parts, `Kino-1.8-Source-Parts-SHA256.txt` and `Restore-Kino-Source.command` from the [1.8 release](https://github.com/iz-tecum/kino-mac/releases/tag/v1.8.0). Put them in one folder and run `bash Restore-Kino-Source.command` there. It restores and verifies the original source ZIP without installing or launching anything. Extract that ZIP and work inside its `project/` directory. See `BUILD-AND-EDIT.txt` for source launch and native build commands. To apply newer code from this checkout, preserve the extracted media and copy the corresponding source files into that workspace.

- `project/export/web/`: shared runtime, Kino and preserved additional-map code and text metadata.
- `project/.tools/` and `project/test/`: browser tools and unit tests.
- `desktop/`: offline Mac wrapper and native packaging/check scripts.
- `universal-packaging/`: pinned architecture merger and dependency lock.
- `V1.8-CHANGES.patch`: text changes from the preserved 1.7 baseline.
- `CODE-SNAPSHOT.json`: source-file hashes and excluded categories.

The project’s original asset and license notices remain in `project/ASSET_NOTICE.md` and `project/LICENSE`. This is an unofficial fan reconstruction. MIT licensing applies to original code only, not third-party game assets. The repository and release downloads are public; downloading does not require a GitHub account. No user profiles, credentials, saves or unrelated files are included.
