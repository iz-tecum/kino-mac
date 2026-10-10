"""Reuse pinned upstream T5 recordings already hydrated in the Moon export.

Copy unchanged encoded bytes only after checking the original Git blob or LFS
object hash. This does not require a game installation or download new audio.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'export/web'
REVISION = '9f871517d87fc702013ef6d9c920f0a23597c8bb'
SOURCE = 'https://github.com/Phi1ow/kino-der-toten'
moon = json.loads((WEB / 'moon/audio/manifest.json').read_text())
manifest_path = WEB / 'audio/manifest.json'
manifest = json.loads(manifest_path.read_text())
recovered = []
for original, metadata in moon.items():
    path = original.removeprefix('moon/')
    selected = '/dry_fire/plr/' in path or path in (
        'wpn/pap/pap_shot_st', 'wpn/pap/pap_flux_left', 'wpn/pap/pap_flux_right',
        'wpn/energy/raygun/raise/activate', 'wpn/energy/raygun/raise/hit',
        'fly/gibs/zombie/elec/elec_00',
    ) or path.startswith('fly/gibs/zombie/head/')
    if not selected:
        continue
    source = WEB / metadata['url']
    payload = source.read_bytes()
    if not payload.startswith(b'OggS'):
        raise ValueError('Decoded Ogg required: ' + str(source))
    git_path = 'export/web/' + metadata['url']
    blob = subprocess.check_output(['git', 'show', REVISION + ':' + git_path], cwd=ROOT)
    encoded_hash = hashlib.sha256(payload).hexdigest()
    pointer = re.search(rb'oid sha256:([a-f0-9]{64})', blob)
    if pointer:
        if pointer.group(1).decode() != encoded_hash:
            raise ValueError('Pinned LFS object mismatch: ' + git_path)
    elif blob != payload:
        raise ValueError('Pinned Git file mismatch: ' + git_path)
    filename = 'shared-' + metadata['sourceSha256'][:20] + '.ogg'
    (WEB / 'audio' / filename).write_bytes(payload)
    key = 'shared/' + path
    manifest[key] = {
        **metadata, 'url': 'audio/' + filename,
        'recoveredFrom': metadata['url'], 'encodedSha256': encoded_hash,
        'sourceRepository': SOURCE, 'sourceCommit': REVISION,
        'sourceTreePath': git_path,
        'usageNote': 'Unchanged original T5 recording. Alias resolution, shared-category selection and reconstructed playback/mix are documented separately.',
    }
    recovered.append({'key': key, 'encodedBytes': len(payload), **manifest[key]})
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
out = ROOT / 'artifacts/v8-audio'
out.mkdir(parents=True, exist_ok=True)
(out / 'shared-recovery.json').write_text(json.dumps({'revision': REVISION, 'count': len(recovered), 'assets': recovered}, indent=2) + '\n')
print(json.dumps({'recovered': len(recovered), 'encodedBytes': sum(r['encodedBytes'] for r in recovered)}))
