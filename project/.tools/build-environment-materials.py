#!/usr/bin/env python3
"""Decode shipped Kino DXT5nm images; never synthesize detail from albedo.

The original material-slot JSON is absent in this checkout. Pairing therefore
uses exact image stems or an unambiguous truncated filename prefix, and the
manifest records that evidence. Surface response values are reconstruction
choices, not recovered T5 shader constants. Requires Pillow and NumPy.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
from urllib.parse import unquote

import numpy as np
from PIL import Image


def decode_dxt5nm(image, max_size=256):
    rgba = np.asarray(image.convert('RGBA'), dtype=np.float32)
    x = rgba[:, :, 3] / 127.5 - 1
    y = rgba[:, :, 1] / 127.5 - 1
    z = np.sqrt(np.maximum(0, 1 - x * x - y * y))
    vectors = np.stack([x, y, z], axis=-1)
    vectors /= np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-6)
    # Resize vectors, not the two compressed scalar channels; renormalize
    # after filtering to retain their hemisphere and avoid dim specular detail.
    if max(image.size) > max_size:
        size = tuple(max(1, round(n * max_size / max(image.size))) for n in image.size)
        vectors = np.stack([np.asarray(Image.fromarray(vectors[:, :, i])
                            .resize(size, Image.Resampling.LANCZOS)) for i in range(3)], axis=-1)
        vectors[:, :, 2] = np.maximum(0, vectors[:, :, 2])
        vectors /= np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-6)
    return Image.fromarray(np.rint(np.clip(vectors * .5 + .5, 0, 1) * 255).astype(np.uint8))


def source_base(material):
    name = material.get('extras', {}).get('sourceMaterialNames', [material['name']])[0]
    if name.startswith('*'):
        match = re.search(r'\(([^:)]+)', name)
        if match:
            return match[1]
    return re.sub(r'^[^:]+:(?=[mw]c/)', '', name)


def classify(name):
    """Most theater surfaces are rough dielectrics or coated metals."""
    if re.search(r'carpet|velvet|curtain|cloth|fabric|seat|clubchair', name):
        return 'fabric', 1.0, .70
    if re.search(r'wood|plywood|floorboard|door_main', name):
        return 'wood', .73, .85
    if re.search(r'brick|concrete|plaster|stone|rock|rubble|asphalt|dirt', name):
        return 'masonry', .94, 1.0
    if re.search(r'column|trim_set|gold_tile|tile', name):
        return 'ornament', .63, .85
    if re.search(r'metal|steel|iron|pipe|generator|projector|vent|zapper|electric|teleport', name):
        return 'coated-metal', .57, .75
    return 'painted-prop', .83, .75


def find_normal(albedo, files):
    stem = Path(albedo).stem.removeprefix('~-g')
    if '~' not in stem:
        candidate = re.sub(r'_(c|d|col)$', '_n', stem)
        if candidate == stem:
            candidate += '_n'
        if candidate + '.png' in files:
            return candidate + '.png', 'exact-image-stem'
    else:
        prefix = stem.split('~', 1)[0]
        candidates = [name for name in files if name.startswith(prefix) and name.endswith('_n.png')]
        if len(candidates) == 1:
            return candidates[0], 'unambiguous-truncated-image-prefix'
    return None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-root', type=Path, default=Path(__file__).resolve().parents[1] / 'export/web')
    args = parser.parse_args()
    root = args.web_root.resolve()
    doc = json.loads((root / 'kino.gltf').read_text())
    files = {p.name for p in (root / 'textures').glob('*.png')}
    output = root / 'environment/normals'
    output.mkdir(parents=True, exist_ok=True)
    entries, converted, skipped = {}, {}, []
    for material in doc['materials']:
        texture = material['pbrMetallicRoughness'].get('baseColorTexture')
        if not texture:
            continue
        source = source_base(material)
        albedo = unquote(doc['images'][doc['textures'][texture['index']]['source']]['uri'])
        # Do not guess how transparent FX, decal layering, faces, weapons, or
        # foliage used their original shader. Those remain untouched.
        if re.search(r'decal|/glo_dec_|/eb_dec_|glass|foliage|ivy|blood|lightshaft|sky|water|eyes|/mtl_c_|/c_|weapon|viewarm', source):
            continue
        filename, evidence = find_normal(albedo, files)
        if not filename:
            skipped.append({'source': source, 'albedo': albedo})
            continue
        category, roughness, strength = classify(source.lower())
        if filename not in converted:
            image = Image.open(root / 'textures' / filename)
            # Retain 512px on the large, carved theater columns/trim only.
            limit = 512 if re.search(r'theater_(column|trim)_set', filename) else 256
            normal = decode_dxt5nm(image, limit)
            normal.save(output / filename, optimize=True)
            converted[filename] = {
                'source': 'textures/' + filename,
                'sourceSha256': hashlib.sha256((root / 'textures' / filename).read_bytes()).hexdigest(),
                'outputSha256': hashlib.sha256((output / filename).read_bytes()).hexdigest(),
                'sourceSize': list(image.size), 'size': list(normal.size),
            }
        entries[albedo] = {
            'normal': 'environment/normals/' + filename, 'sourceNormal': 'textures/' + filename,
            'pairing': evidence, 'surface': category, 'roughness': roughness,
            # Coated metal is a dielectric. Avoid guessed metallic channels
            # from the native packed specular textures, whose slots are absent.
            'metalness': 0, 'normalScale': [strength, -strength],
        }
    manifest = {
        'version': 1, 'source': 'Locally shipped native PNG normal images; DXT5nm X=alpha, Y=green, positive Z reconstructed.',
        'limitations': 'Filename-paired normal detail. Surface parameters are reconstructed; native material layering, specular slot metadata and T5 lightmaps are unavailable.',
        'normalConvention': 'Decoded DirectX tangent normal; negative material Y scale converts handedness for the existing glTF UVs.',
        'materials': entries, 'textures': converted, 'unmatched': skipped,
        'estimatedGpuBytesWithMipmaps': round(sum(v['size'][0] * v['size'][1] * 4 * 4 / 3 for v in converted.values())),
    }
    (root / 'environment-materials.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'materials': len(entries), 'normalTextures': len(converted),
                      'gpuMiBWithMipmaps': round(manifest['estimatedGpuBytesWithMipmaps'] / 1024 ** 2, 2),
                      'pngBytes': sum(p.stat().st_size for p in output.glob('*.png'))}))


if __name__ == '__main__':
    main()
