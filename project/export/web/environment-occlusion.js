import * as THREE from 'three';

/** Stable identifier for the exact vertex order used by the offline bake. */
export function geometryFingerprint(position, normal) {
  if (position.isInterleavedBufferAttribute || normal.isInterleavedBufferAttribute) return null;
  let hash = 2166136261;
  for (const attribute of [position, normal]) {
    const bytes = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
  }
  return `${position.count}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function eligible(mesh) {
  if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length ||
      !mesh.geometry?.attributes.position || !mesh.geometry.attributes.normal) return false;
  let worldShell = false;
  for (let ancestor = mesh; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.visible || ancestor.userData?.dynamicBrush || ancestor.userData?.collisionOnly) return false;
    if (ancestor.name === 'world_shell' || ancestor.name.startsWith('world_shell_')) worldShell = true;
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return worldShell && materials.every(material => material?.isMeshStandardMaterial &&
    !material.transparent && !material.transmission && !material.alphaTest &&
    material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile);
}

export function geometryWithOcclusion(source, occlusion) {
  const count = source.attributes.position.count;
  if (occlusion.length !== count) throw new Error('Baked occlusion vertex count mismatch');
  const original = source.attributes.color;
  const components = original?.itemSize || 3;
  // Keep any unusual HDR vertex colors in float form instead of clipping them.
  let hdr = false;
  if (original) for (let i = 0; i < count && !hdr; i++) {
    hdr = [original.getX(i), original.getY(i), original.getZ(i)].some(v => v < 0 || v > 1);
  }
  const color = hdr ? new Float32Array(count * components) : new Uint8Array(count * components);
  for (let i = 0; i < count; i++) {
    const ao = occlusion[i] / 255;
    const values = original ? [original.getX(i), original.getY(i), original.getZ(i), original.getW(i)] : [1, 1, 1, 1];
    for (let channel = 0; channel < components; channel++) {
      const value = values[channel] * (channel < 3 ? ao : 1);
      color[i * components + channel] = hdr ? value : Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
    }
  }
  // Reuse immutable source position/normal/UV/index buffers. A fresh geometry
  // keeps the original object and any other users completely untouched.
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.setAttribute('color', new THREE.BufferAttribute(color, components, !hdr));
  geometry.groups = source.groups.map(group => ({ ...group }));
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() || null;
  geometry.boundingSphere = source.boundingSphere?.clone() || null;
  geometry.name = source.name;
  geometry.userData = { ...source.userData, environmentOcclusion: true };
  return geometry;
}

/** Newly baked, bounded contact attenuation. No original lightmap is implied. */
export async function applyEnvironmentOcclusion(root, {
  manifest, binary, manifestUrl = 'environment-occlusion.json',
} = {}) {
  manifest ??= await fetch(manifestUrl).then(response => {
    if (!response.ok) throw new Error(`Environment occlusion manifest: ${response.status}`);
    return response.json();
  });
  if (manifest.version !== 1) throw new Error('Unsupported environment occlusion manifest');
  binary ??= await fetch(new URL(manifest.binary, new URL(manifestUrl, globalThis.location.href))).then(response => {
    if (!response.ok) throw new Error(`Environment occlusion data: ${response.status}`);
    return response.arrayBuffer();
  });
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  if (bytes.byteLength !== manifest.byteLength) throw new Error('Environment occlusion byte length mismatch');
  const stats = { meshes: 0, vertices: 0, colorBytes: 0, skipped: 0 };
  const shadedMaterials = new Map();
  root.traverse(mesh => {
    if (!eligible(mesh)) return;
    const source = mesh.geometry;
    const fingerprint = geometryFingerprint(source.attributes.position, source.attributes.normal);
    const entry = manifest.geometry[fingerprint];
    if (!entry || entry.count !== source.attributes.position.count) { stats.skipped += 1; return; }
    if (entry.offset < 0 || entry.offset + entry.count > bytes.length) throw new Error('Environment occlusion range is invalid');
    mesh.geometry = geometryWithOcclusion(source, bytes.subarray(entry.offset, entry.offset + entry.count));
    const shade = material => {
      // Map materials may also be used by doors/props with no color attribute.
      // Leave those shared originals alone; one AO variant per original keeps
      // shaded static meshes batchable without blackening uncolored users.
      if (!shadedMaterials.has(material)) {
        const shaded = material.clone(); shaded.vertexColors = true; shaded.needsUpdate = true;
        shadedMaterials.set(material, shaded);
      }
      return shadedMaterials.get(material);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shade) : shade(mesh.material);
    stats.meshes += 1; stats.vertices += entry.count;
    stats.colorBytes += mesh.geometry.attributes.color.array.byteLength;
  });
  return stats;
}
