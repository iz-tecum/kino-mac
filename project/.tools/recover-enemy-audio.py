"""Recover pinned NZ:P community recordings, preserving original PCM WAV bytes.

These are replacement recordings, not recovered Black Ops creature vocals.
The downloadable source bank and any runtime pitch adaptations retain CC BY-SA.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'export/web'
OUT = WEB / 'audio/enemies'
AUDIT = ROOT / 'artifacts/v3-enemy-audio'
COMMIT = '70a14104914f2fc65b99b3c58b1f92c2356ecf76'
REPOSITORY = 'https://github.com/nzp-team/assets'
LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/'
RAW = f'https://raw.githubusercontent.com/nzp-team/assets/{COMMIT}/'


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Kino-Enemy-Audio-Recovery'}), timeout=45).read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    AUDIT.mkdir(parents=True, exist_ok=True)
    tree = json.loads(get(f'https://api.github.com/repos/nzp-team/assets/git/trees/{COMMIT}?recursive=1'))
    if tree.get('truncated'):
        raise ValueError('Complete source tree required')
    blobs = {item['path']: item for item in tree['tree']}
    paths = [f'pc/nzp/sounds/zombie/{letter}{n}.wav' for letter, count in [('a', 8), ('d', 8), ('r', 10), ('t', 5), ('w', 10)] for n in range(count)]
    paths += [f'common/sounds/hound/{name}.wav' for name in ['a0', 'd0', 't0', 't1']]
    paths += ['pc/nzp/sounds/misc/barricade.wav', 'pc/nzp/sounds/misc/barricade_destroy.wav']

    def recover(source_path):
        payload = get(RAW + source_path)
        git_blob = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
        if git_blob != blobs[source_path]['sha']:
            raise ValueError('Pinned Git blob mismatch: ' + source_path)
        with wave.open(io.BytesIO(payload), 'rb') as audio:
            rate, channels, frames, width = audio.getframerate(), audio.getnchannels(), audio.getnframes(), audio.getsampwidth()
            if width not in [1, 2, 3, 4] or channels not in [1, 2] or frames == 0:
                raise ValueError('Valid PCM source required: ' + source_path)
        group = 'hound' if '/hound/' in source_path else 'zombie' if '/zombie/' in source_path else 'barrier'
        filename = group + '-' + Path(source_path).name
        (OUT / filename).write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()
        key = f'enemy/nzp/{group}/{Path(source_path).stem}'
        return key, {
            'url': 'audio/enemies/' + filename,
            'source': REPOSITORY + '/blob/' + COMMIT + '/' + source_path,
            'sourceRepository': REPOSITORY, 'sourceCommit': COMMIT, 'sourcePath': source_path,
            'sourceGitBlob': git_blob, 'sourceSha256': digest, 'encodedSha256': digest,
            'duration': frames / rate, 'sampleRate': rate, 'channels': channels, 'sampleWidth': width,
            'native': False, 'sourceType': 'community-recording', 'license': LICENSE,
            'attribution': 'NZ:P Team, 2025; sound credits: Blubswillrule, Biodude, Cypress, Marty P.',
            'transformation': 'Original WAV bytes unchanged. Nova uses runtime playback-rate adaptation of zombie crawler/attack/death recordings; state timing and mix are reconstruction choices.',
        }

    with ThreadPoolExecutor(max_workers=6) as pool:
        recovered = dict(pool.map(recover, paths))
    manifest_path = WEB / 'audio/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest.update(recovered)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    (OUT / 'LICENSE.md').write_bytes(get(RAW + 'LICENSE.md'))
    (OUT / 'ATTRIBUTION.txt').write_text(
        'Creature and barricade recordings: NZ:P Team (2025).\n'
        'Sound credits: Blubswillrule, Biodude, Cypress, Marty P.\n'
        + REPOSITORY + '/tree/' + COMMIT + '\n'
        'License: Creative Commons Attribution-ShareAlike 4.0 International.\n' + LICENSE + '\n'
        'Source WAV files are unchanged. Nova pitch and all event timing/mixing are new runtime adaptations.\n'
        'Recordings and their adaptations retain CC BY-SA 4.0. These are community replacements, not exact Black Ops creature recordings.\n'
        'The separate existing dog.ogg growl remains a recovered T5 recording under its existing asset notice.\n'
    )
    catalog = {
        'sourceRepository': REPOSITORY, 'sourceCommit': COMMIT, 'license': LICENSE,
        'sourceMapping': 'https://github.com/nzp-team/quakec/tree/8a77f1ce45f1a2b9aa0afb301446954fda40e696/source/server/ai',
        'sourceRules': 'User-supplied BO1-Reimagined-master.zip: maps/_zombiemode_audio.gsc (ambient, sprint, attack, teardown, behind, death; per-actor talking guard); maps/_zombiemode_ai_dogs.gsc; maps/_zombiemode_ai_quad.gsc.',
        'fidelity': 'NZ:P state-family replacements. Native T5 zombie/Nova/Hellhound attack/death banks were absent from the recovered fork and uploaded ZIP. Native dog.ogg is retained for quiet hound growls. Nova pitch adaptations are explicitly approximate.',
        'count': len(recovered), 'encodedBytes': sum((WEB / item['url']).stat().st_size for item in recovered.values()),
        'assets': [{'key': key, **item} for key, item in sorted(recovered.items())],
    }
    (OUT / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
    (AUDIT / 'asset-recovery.json').write_text(json.dumps(catalog, indent=2) + '\n')
    print(json.dumps({key: catalog[key] for key in ['sourceCommit', 'count', 'encodedBytes']}))


if __name__ == '__main__':
    main()
