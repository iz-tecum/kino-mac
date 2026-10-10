import * as THREE from 'three';

function albedoPath(texture) {
  const url = texture?.userData?.sourceUrl || texture?.source?.data?.src || texture?.image?.src || texture?.name || '';
  try {
    const path = decodeURIComponent(new URL(url, 'https://local.invalid/').pathname);
    const index = path.lastIndexOf('/textures/');
    return index >= 0 ? path.slice(index + 1) : path.replace(/^\//, '');
  } catch { return ''; }
}

function visibleSurface(mesh) {
  if (!mesh.isMesh || mesh.isSkinnedMesh || !mesh.geometry?.attributes?.uv || mesh.morphTargetInfluences?.length) return false;
  for (let object = mesh; object; object = object.parent) {
    if (!object.visible || object.userData?.collisionOnly) return false;
  }
  return true;
}

function compatible(material) {
  return material?.isMeshStandardMaterial && !material.transparent && !material.normalMap &&
    !material.transmission && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
}

export function configureEnvironmentNormal(normal, albedo, anisotropy = 2) {
  // Match the existing glTF texture transform exactly: no geometry/UV rewrite.
  normal.flipY = albedo.flipY;
  normal.channel = albedo.channel;
  normal.wrapS = albedo.wrapS; normal.wrapT = albedo.wrapT;
  normal.offset.copy(albedo.offset); normal.repeat.copy(albedo.repeat);
  normal.center.copy(albedo.center); normal.rotation = albedo.rotation;
  normal.matrixAutoUpdate = albedo.matrixAutoUpdate;
  normal.matrix.copy(albedo.matrix);
  normal.colorSpace = THREE.NoColorSpace;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.magFilter = THREE.LinearFilter;
  normal.generateMipmaps = true;
  normal.anisotropy = Math.max(1, Math.min(4, anisotropy));
  normal.needsUpdate = true;
  return normal;
}

/** Attach decoded, filename-matched native normals before static batching.
 * Material identities and all geometry buffers remain unchanged. TextureLoader
 * uses the same manager as the map, so offline URL policy and asset accounting
 * remain in force. Supplying a manifest/loader also permits deterministic tests.
 */
export async function enhanceEnvironmentMaterials(root, {
  manager, manifest, manifestUrl = 'environment-materials.json',
  loadTexture, anisotropy = 2,
} = {}) {
  manifest ??= await fetch(manifestUrl).then(response => {
    if (!response.ok) throw new Error(`Environment material manifest: ${response.status}`);
    return response.json();
  });
  if (manifest.version !== 1) throw new Error('Unsupported environment material manifest');
  const loader = loadTexture || (url => new THREE.TextureLoader(manager).loadAsync(url));
  const materials = new Map();
  root.traverse(mesh => {
    if (!visibleSurface(mesh)) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!compatible(material) || !material.map) continue;
      const entry = manifest.materials[albedoPath(material.map)];
      if (entry) materials.set(material, entry);
    }
  });
  const images = new Map();
  const stats = { materials: 0, textures: 0, estimatedGpuBytesWithMipmaps: manifest.estimatedGpuBytesWithMipmaps || 0 };
  await Promise.all([...materials].map(async ([material, entry]) => {
    // The same native image can serve several distinct material transforms.
    // Share decoded image data, then clone only the lightweight Texture state.
    if (!images.has(entry.normal)) images.set(entry.normal, loader(entry.normal));
    const source = await images.get(entry.normal);
    const normal = configureEnvironmentNormal(source.clone(), material.map, anisotropy);
    material.normalMap = normal;
    material.normalScale.fromArray(entry.normalScale);
    material.roughness = entry.roughness;
    material.metalness = entry.metalness;
    material.userData.environmentMaterial = {
      sourceNormal: entry.sourceNormal, pairing: entry.pairing, surface: entry.surface,
    };
    material.needsUpdate = true;
    stats.materials += 1;
  }));
  stats.textures = images.size;
  return stats;
}
