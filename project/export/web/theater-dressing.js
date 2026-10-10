import * as THREE from 'three';

const softDecal = /^wc\/(?:glo_dec_blood_|eb_ter_trashpile_blend)/;
export const nativeMultiplyDecalNames = Object.freeze([
  'wc/decal_burn_scortch', 'wc/decal_burntstain_01', 'wc/decal_burntstain_02',
  'wc/decal_darkstain_02', 'wc/decal_darkstain_04', 'wc/decal_darkstain_07',
  'wc/decal_grime_blotchy', 'wc/decal_grime_drip', 'wc/decal_lightstain_03', 'wc/decal_wall_fillet',
]);
const multiplyDecals = new Set(nativeMultiplyDecalNames);
function sourceName(material) { return material?.userData?.sourceMaterialNames?.[0] || material?.name || ''; }
function visibleStatic(mesh) {
  if (!mesh.isMesh || mesh.isSkinnedMesh) return false;
  for (let p = mesh; p; p = p.parent) if (!p.visible || p.userData.dynamicBrush || p.userData.collisionOnly) return false;
  return true;
}
export function softenNativeDecal(material) {
  const shade = material.clone();
  shade.transparent = true; shade.alphaTest = .012; shade.depthWrite = false;
  shade.polygonOffset = true; shade.polygonOffsetFactor = -1; shade.polygonOffsetUnits = -1;
  shade.forceSinglePass = true; shade.userData = { ...material.userData, restoredNativeDecal: true };
  shade.needsUpdate = true;
  return shade;
}
export function restoreMultiplyDecal(material) {
  // This native RGB texture stores attenuation with an opaque white neutral
  // background. Lighting/AO, tone mapping and fog would darken that neutral
  // white and expose the projected triangle borders. Multiply the already-lit
  // scene directly, preserving the original UVs and depth-tested surface shape.
  const shade = new THREE.MeshBasicMaterial({ map: material.map, color: 0xffffff,
    blending: THREE.MultiplyBlending, transparent: true, premultipliedAlpha: true, opacity: 1,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    forceSinglePass: true, toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  shade.name = material.name; shade.userData = { ...material.userData, restoredMultiplyDecal: true };
  return shade;
}
function withoutBakedLight(source) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) if (!['kinoBaseLight', 'kinoPowerLight', 'kinoSolarLight', 'color'].includes(name)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index); geometry.groups = source.groups.map(g => ({ ...g }));
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() || null; geometry.boundingSphere = source.boundingSphere?.clone() || null;
  geometry.name = source.name; geometry.userData = { restoredMultiplyDecal: true };
  return geometry;
}
export function interpolateSourceAttribute(attribute, indices, weights, fallback = [0, 0, 0]) {
  if (!attribute) return fallback;
  return [0, 1, 2].map(channel => indices.reduce((sum, at, j) => sum + attribute.getComponent(at, channel) * weights[j], 0));
}

/** Soft native authored decals + bounded reconstructed overlays. Call after
 * prepareTheaterLightField and before batching/lightfield.install. Floor source
 * attributes are interpolated on the same triangles, including baked sunlight.
 * No geometry or material shared with dynamic/hidden objects is mutated.
 */
export async function restoreTheaterDressing(root, scene, data, {
  manager, manifest, manifestUrl = 'theater-dressing.json', loadTexture,
} = {}) {
  if (root.userData.theaterDressing) return root.userData.theaterDressing;
  manifest ??= await fetch(manifestUrl).then(r => { if (!r.ok) throw Error('Theater dressing: ' + r.status); return r.json(); });
  if (manifest.version !== 1) throw Error('Unsupported theater dressing manifest');
  const stats = { nativeDecalMeshes: 0, nativeDecalMaterials: 0, multiplyDecalMeshes: 0, ornamentMaterials: 0, patches: 0, drawCalls: 0, triangles: 0, vertices: 0, copiedLightAttributes: [], skipped: [], source: manifest.provenance };
  const variants = new Map(), ornaments = new Map(), sourceMeshes = new Map();
  root.traverse(mesh => {
    if (!visibleStatic(mesh)) return;
    let shell = false; for (let p = mesh; p; p = p.parent) if (p.name === 'world_shell' || p.name.startsWith('world_shell_')) shell = true;
    if (shell && !Array.isArray(mesh.material)) sourceMeshes.set(mesh.material.name, mesh);
    if (!Array.isArray(mesh.material) && multiplyDecals.has(sourceName(mesh.material))) {
      mesh.material = restoreMultiplyDecal(mesh.material); mesh.geometry = withoutBakedLight(mesh.geometry); mesh.renderOrder = 2; stats.multiplyDecalMeshes++; return;
    }
    const fix = material => {
      if (material?.isMeshStandardMaterial && /chandelier.*:mc\/mtl_zombie_theater_chandelier_off/.test(sourceName(material)) && !material.alphaTest) {
        // Retain the source's dielectric response: there is no reflection
        // environment, and adding metalness would remove readable diffuse light.
        if (!ornaments.has(material)) { const shade = material.clone(); shade.roughness = .68; shade.metalness = 0; ornaments.set(material, shade); }
        return ornaments.get(material);
      }
      if (!material?.isMeshStandardMaterial || !(softDecal.test(sourceName(material)) || sourceName(material) === 'wc/decal_lightstain_01')) return material;
      if (!variants.has(material)) variants.set(material, softenNativeDecal(material));
      stats.nativeDecalMeshes++; return variants.get(material);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
  });
  stats.nativeDecalMaterials = variants.size;
  stats.ornamentMaterials = ornaments.size;
  const group = new THREE.Group(); group.name = 'theater_dressing';
  const loader = loadTexture || (url => new THREE.TextureLoader(manager).loadAsync(url));
  for (const [kind, entry] of Object.entries(manifest.textures)) {
    const patches = manifest.patches.filter(p => p.kind === kind), positions = [], normals = [], uvs = [], colors = [];
    const light = Object.fromEntries(['kinoBaseLight', 'kinoPowerLight', 'kinoSolarLight'].map(name => [name, []]));
    let hasLight = false;
    for (const patch of patches) {
      let accepted = false;
      for (const part of patch.parts) {
        const source = sourceMeshes.get(part.materialName);
        if (!source) { stats.skipped.push(patch.id + ': native floor unavailable'); continue; }
        const attributes = source.geometry.attributes;
        if (part.vertices.some(v => v.indices.some(i => i < 0 || i >= attributes.position.count))) throw Error('Dressing source vertex mismatch');
        for (const vertex of part.vertices) {
          positions.push(...vertex.position); normals.push(0, 1, 0); uvs.push(...vertex.uv);
          colors.push(...interpolateSourceAttribute(attributes.color, vertex.indices, vertex.weights, [1, 1, 1]));
          for (const [name, values] of Object.entries(light)) values.push(...interpolateSourceAttribute(attributes[name], vertex.indices, vertex.weights));
        }
        hasLight ||= !!attributes.kinoBaseLight; accepted = true;
      }
      if (accepted) stats.patches++;
    }
    if (!positions.length) continue;
    const texture = await loader(entry.texture); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.anisotropy = 2;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: kind === 'debris' ? .95 : .74, metalness: 0, vertexColors: true, transparent: true, opacity: kind === 'debris' ? .9 : .94, alphaTest: .012, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    material.name = 'restored_floor_layer_' + kind;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (hasLight) for (const [name, values] of Object.entries(light)) { geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 3)); if (!stats.copiedLightAttributes.includes(name)) stats.copiedLightAttributes.push(name); }
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'reconstructed_' + kind + '_floor_layers'; mesh.renderOrder = 1; group.add(mesh);
    stats.vertices += positions.length / 3; stats.triangles += positions.length / 9; stats.drawCalls++;
  }
  root.add(group); root.userData.theaterDressing = stats;
  return stats;
}
