#!/usr/bin/env python3
"""Package a verified Electron runtime and a prepared static web root. No downloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def ignored(_directory, names):
    return [name for name in names if name in {'.git', '.DS_Store', '__pycache__'}]


def remove_finder_metadata(app):
    # Finder/File Provider may attach these to a downloaded runtime. They are
    # forbidden inside a signed bundle; preserve unrelated extended attributes.
    for name in ['com.apple.FinderInfo', 'com.apple.ResourceFork']:
        subprocess.run(['/usr/bin/xattr', '-dr', name, str(app)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def main():
    packaging = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('web_root', type=Path, help='Prepared offline directory containing index.html')
    parser.add_argument('output_app', type=Path, help='New output path ending in .app')
    parser.add_argument('--runtime', type=Path, default=packaging.parent / 'desktop-runtime')
    parser.add_argument('--credits', type=Path, action='append', default=[], help='Credit or license file to include; repeatable')
    parser.add_argument('--icon', type=Path, help='Optional .icns application icon')
    parser.add_argument('--zip', action='store_true', help='Also create a portable ZIP beside the app')
    parser.add_argument('--zip-output', type=Path, help='Create the portable ZIP at this new path instead')
    args = parser.parse_args()
    root, output, runtime = args.web_root.resolve(), args.output_app.resolve(), args.runtime.resolve()
    if not (root / 'index.html').is_file():
        parser.error('The web root must contain index.html')
    if output.suffix != '.app' or output.exists():
        parser.error('Choose a new output path ending in .app; existing apps are never overwritten')
    zip_path = args.zip_output.resolve() if args.zip_output else output.with_suffix('.zip') if args.zip else None
    if zip_path and zip_path.exists():
        parser.error(f'Archive already exists: {zip_path}')
    if args.icon and (not args.icon.is_file() or args.icon.suffix.lower() != '.icns'):
        parser.error('--icon must name an existing .icns file')
    for credit in args.credits:
        if not credit.is_file():
            parser.error(f'Credit file does not exist: {credit}')
    # Refuse hidden links to material outside the intended bundle root.
    for directory, subdirs, files in os.walk(root):
        subdirs[:] = [name for name in subdirs if name not in {'.git', '__pycache__'}]
        for name in subdirs + files:
            candidate = Path(directory) / name
            if candidate.is_symlink():
                parser.error(f'Prepare a web root without symlinks first: {candidate}')
    verification = json.loads((runtime / 'verified-runtime.json').read_text())
    archive = runtime / verification['filename']
    if hashlib.sha256(archive.read_bytes()).hexdigest() != verification['sha256']:
        parser.error('Electron archive checksum does not match the verified runtime record')
    if verification['architecture'] not in {'darwin-arm64','darwin-x64'}:
        parser.error('This wrapper requires an official macOS arm64 or x64 runtime')
    extract = runtime / ('extracted-' + verification['version'] + '-' + verification['architecture'])
    if not (extract / 'Electron.app').is_dir():
        extract.mkdir(parents=True, exist_ok=True)
        run('/usr/bin/ditto', '-x', '-k', archive, extract)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Build and archive outside Documents/Desktop/iCloud. File Provider can add
    # FinderInfo immediately after cleanup in those locations and invalidate
    # strict signature verification even when no file content has changed.
    with tempfile.TemporaryDirectory(prefix='kino-bundle-') as temp:
        staged = Path(temp) / output.name
        shutil.copytree(extract / 'Electron.app', staged, symlinks=True)
        resources = staged / 'Contents' / 'Resources'
        default = resources / 'default_app.asar'
        if default.exists():
            default.unlink()
        app_root = resources / 'app'
        (app_root / 'scripts').mkdir(parents=True)
        for filename in ['main.mjs', 'package.json']:
            shutil.copy2(packaging / filename, app_root / filename)
        for filename in ['server.mjs','window-size.mjs','local-fetch.mjs']:
            shutil.copy2(packaging / 'scripts' / filename, app_root / 'scripts' / filename)
        shutil.copytree(root, app_root / 'game', ignore=ignored)
        licenses = resources / 'licenses'
        licenses.mkdir(exist_ok=True)
        for filename in ['LICENSE', 'LICENSES.chromium.html']:
            candidate = extract / filename
            if candidate.exists():
                shutil.copy2(candidate, licenses / ('Electron-' + filename))
        # Chromium notices may be stored inside Resources in some releases.
        for filename in ['LICENSE', 'LICENSES.chromium.html']:
            candidate = resources / filename
            if candidate.exists():
                shutil.copy2(candidate, licenses / ('Electron-' + filename))
        for credit in args.credits:
            destination = licenses / credit.name
            if destination.exists():
                parser.error(f'Duplicate credit filename: {credit.name}')
            shutil.copy2(credit, destination)
        (resources / 'runtime-provenance.json').write_text(json.dumps(verification, indent=2) + '\n')
        metadata = staged / 'Contents' / 'Info.plist'
        with metadata.open('rb') as stream:
            info = plistlib.load(stream)
        executable = staged / 'Contents' / 'MacOS' / info['CFBundleExecutable']
        executable.rename(executable.with_name('Kino der Toten'))
        info.update({
            'CFBundleName': 'Kino der Toten',
            'CFBundleDisplayName': 'Kino der Toten',
            'CFBundleExecutable': 'Kino der Toten',
            'CFBundleIdentifier': 'local.kino.der-toten',
            'CFBundleShortVersionString': json.loads((packaging / 'package.json').read_text())['version'],
            'CFBundleVersion': '9',
            'LSApplicationCategoryType': 'public.app-category.action-games',
            'NSHumanReadableCopyright': 'Unofficial fan reconstruction. See Resources/licenses.',
        })
        if args.icon:
            shutil.copy2(args.icon, resources / 'kino.icns')
            info['CFBundleIconFile'] = 'kino.icns'
        # The offline game does not request camera, microphone, or Bluetooth access.
        for key in ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSBluetoothAlwaysUsageDescription']:
            info.pop(key, None)
        with metadata.open('wb') as stream:
            plistlib.dump(info, stream)
        entitlements = Path(temp) / 'entitlements.plist'
        with entitlements.open('wb') as stream:
            plistlib.dump({'com.apple.security.cs.allow-jit': True,
                          'com.apple.security.cs.allow-unsigned-executable-memory': True}, stream)
        remove_finder_metadata(staged)
        run('/usr/bin/codesign', '--force', '--deep', '--sign', '-', '--entitlements', entitlements, staged)
        run('/usr/bin/codesign', '--verify', '--deep', '--strict', staged)
        if zip_path:
            zip_path.parent.mkdir(parents=True, exist_ok=True)
            run('/usr/bin/ditto', '-c', '-k', '--norsrc', '--noextattr', '--keepParent', staged, zip_path)
        shutil.move(staged, output)
    remove_finder_metadata(output)
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', output)
    manifest = {'application': str(output), 'runtime': verification,
                'web_root': str(root), 'architecture': verification['architecture'].removeprefix('darwin-'), 'signing': 'local ad-hoc; not notarized'}
    output.with_suffix('.build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
