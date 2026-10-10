"""Copy already-decoded shared T5 cues from the local Moon asset index into Kino.

No downloads or audio generation. Run after native extraction if rebuilding the
Kino manifest. Exact original and copied-file hashes stay in its provenance.
"""
from pathlib import Path
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1] / 'export/web'
manifest_path = root / 'audio/manifest.json'
manifest = json.loads(manifest_path.read_text())
moon = json.loads((root / 'moon/audio/manifest.json').read_text())
copied = []
for key, metadata in moon.items():
    path = key.removeprefix('moon/')
    movement = (
        path.startswith('fly/footsteps/')
        and any('/' + gait + '/' in path for gait in ('walk', 'run', 'sprint', 'land'))
        and any('/' + material + '/' in path for material in ('wood', 'concrete', 'carpet', 'metal', 'dirt'))
    )
    impact = path.startswith('wpn/grenade/explosion/explode/') or path in (
        'wpn/energy/raygun/projectile/impact/wpn_ray_exp',
        'wpn/energy/thundergun/projectile/impact/impact_00',
    )
    equipment = path.startswith('wpn/monkey/monkey_song_') or path in (
        'wpn/monkey/monkey_ratchet',
        'wpn/grenade/claymore/claymore_plant_00',
    )
    if not (movement or impact or equipment):
        continue
    source = root / metadata['url']
    payload = source.read_bytes()
    if not payload.startswith(b'OggS'):
        raise ValueError(f'Actual decoded Ogg required, not a missing-asset pointer: {source}')
    filename = 'shared-' + metadata['sourceSha256'][:20] + '.ogg'
    shutil.copy2(source, root / 'audio' / filename)
    manifest['shared/' + path] = {
        **metadata,
        'url': 'audio/' + filename,
        'recoveredFrom': metadata['url'],
        'encodedSha256': hashlib.sha256(payload).hexdigest(),
        'usageNote': 'Original T5 shared recording; playback timing, surface selection and mix are reconstruction choices.',
    }
    copied.append(filename)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Copied {len(copied)} existing original recordings with SHA256 provenance.')
