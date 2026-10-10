import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _rootInverse = new THREE.Matrix4();
const _relativeMatrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _box = new THREE.Box3();

function identityFor(value, ids, cursor) {
  if (!ids.has(value)) ids.set(value, cursor.value++);
  return ids.get(value);
}

function opaqueMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.length > 0 && materials.every((entry) => entry && entry.visible &&
    !entry.transparent && entry.opacity >= 1 && !(entry.transmission > 0) &&
    entry.depthWrite && !entry.isShaderMaterial &&
    entry.onBeforeRender === THREE.Material.prototype.onBeforeRender &&
    entry.onBeforeCompile === THREE.Material.prototype.onBeforeCompile &&
    entry.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey);
}

function protectedObject(object) {
  return !object.visible || object.isSkinnedMesh || object.isBone || object.animations?.length > 0 ||
    object.morphTargetInfluences || object.userData?.dynamicBrush || object.userData?.dynamic ||
    object.userData?.animated || object.userData?.collisionOnly || object.userData?.static === false ||
    (object.isGroup && object.renderOrder !== 0) || object.customDepthMaterial || object.customDistanceMaterial ||
    object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
    object.onAfterRender !== THREE.Object3D.prototype.onAfterRender ||
    object.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow ||
    object.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow;
}

function protectedBranch(object, root) {
  for (let current = object; current; current = current.parent) {
    if (protectedObject(current)) return true;
    if (current === root) break;
  }
  return false;
}

function renderKey(object) {
  return [object.castShadow ? 1 : 0, object.receiveShadow ? 1 : 0,
    object.renderOrder, object.layers.mask, object.frustumCulled ? 1 : 0].join('|');
}

function copyRenderState(source, batch) {
  batch.castShadow = source.castShadow;
  batch.receiveShadow = source.receiveShadow;
  batch.renderOrder = source.renderOrder;
  batch.layers.mask = source.layers.mask;
  batch.frustumCulled = source.frustumCulled;
  batch.matrixAutoUpdate = false;
  batch.matrix.identity();
}

function mergeLayout(geometry) {
  // Material groups and partial draw ranges retain their original mesh. Baking
  // these into one draw would otherwise expose intentionally undrawn triangles.
  if (geometry.groups.length || geometry.drawRange.start !== 0 ||
      geometry.drawRange.count !== Infinity || geometry.isInstancedBufferGeometry ||
      Object.keys(geometry.morphAttributes).length) return null;
  const position = geometry.attributes.position;
  if (!position || position.itemSize !== 3) return null;
  const names = Object.keys(geometry.attributes).sort();
  const layout = [geometry.index ? 'indexed' : 'nonindexed'];
  for (const name of names) {
    const attribute = geometry.attributes[name];
    if (attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute ||
        attribute.count !== position.count || !attribute.array) return null;
    if (['position', 'normal', 'tangent'].includes(name) &&
        (attribute.normalized || !(attribute.array instanceof Float32Array ||
          attribute.array instanceof Float64Array))) return null;
    layout.push([name, attribute.itemSize, attribute.normalized,
      attribute.array.constructor.name, attribute.gpuType].join(':'));
  }
  return layout.join('|');
}

function freezeStaticTransforms(object) {
  if (protectedObject(object)) return false;
  let staticBranch = true;
  for (const child of object.children) if (!freezeStaticTransforms(child)) staticBranch = false;
  if (staticBranch) object.matrixAutoUpdate = false;
  return staticBranch;
}

/**
 * Instance repeated geometry, then merge compatible remaining opaque meshes.
 * Keeping each batch inside one cell preserves coarse frustum culling while
 * removing most per-prop Object3D traversal and matrix work.
 */
export function optimizeStaticScene(root, {
  cellSize = 640,
  verticalCellSize = 256,
  minInstances = 2,
  mergeStatic = true,
  maxMergedVertices = 100000,
} = {}) {
  if (!root?.isObject3D) throw new TypeError('optimizeStaticScene requires an Object3D');
  if (!(cellSize > 0) || !(verticalCellSize > 0) || !Number.isFinite(cellSize) ||
      !Number.isFinite(verticalCellSize) || !Number.isInteger(minInstances) || minInstances < 2 ||
      !Number.isInteger(maxMergedVertices) || maxMergedVertices < 3) throw new RangeError('Invalid static batch options');
  root.updateWorldMatrix(true, true);
  _rootInverse.copy(root.matrixWorld).invert();
  const geometryIds = new WeakMap();
  const materialIds = new WeakMap();
  const cursor = { value: 1 };
  const groups = new Map();
  const meshes = [];
  let objectsBefore = 0;

  root.traverseVisible((object) => {
    objectsBefore += 1;
    if (object === root || !object.isMesh || object.isInstancedMesh || object.children.length ||
        protectedBranch(object, root)) return;
    if (!object.geometry || !opaqueMaterial(object.material) || Object.keys(object.geometry.morphAttributes).length) return;
    _relativeMatrix.multiplyMatrices(_rootInverse, object.matrixWorld);
    // InstancedMesh does not support mirrored transforms. Leaving singular or
    // mirrored meshes in place also preserves face winding and tangent parity.
    if (!(_relativeMatrix.determinant() > 0)) return;
    _position.setFromMatrixPosition(_relativeMatrix);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const materialKey = materials.map((material) => identityFor(material, materialIds, cursor)).join(',');
    const key = [
      identityFor(object.geometry, geometryIds, cursor),
      materialKey,
      Math.floor(_position.x / cellSize),
      Math.floor(_position.y / verticalCellSize),
      Math.floor(_position.z / cellSize),
      renderKey(object),
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    const entry = { object, matrix: _relativeMatrix.clone() };
    groups.get(key).push(entry);
    meshes.push(entry);
  });

  let batches = 0;
  let removedMeshes = 0;
  for (const entries of groups.values()) {
    if (entries.length < minInstances) continue;
    const source = entries[0].object;
    const batch = new THREE.InstancedMesh(source.geometry, source.material, entries.length);
    batch.name = `static_batch_${batches}`;
    copyRenderState(source, batch);
    for (let i = 0; i < entries.length; i += 1) batch.setMatrixAt(i, entries[i].matrix);
    batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    root.add(batch);
    for (const entry of entries) { entry.object.removeFromParent(); entry.batched = true; }
    batches += 1;
    removedMeshes += entries.length;
  }

  const mergeGroups = new Map();
  if (mergeStatic) for (const entry of meshes) {
    const { object, matrix } = entry;
    if (entry.batched || Array.isArray(object.material)) continue;
    const layout = mergeLayout(object.geometry);
    if (!layout || object.geometry.attributes.position.count > maxMergedVertices) continue;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    _box.copy(object.geometry.boundingBox).applyMatrix4(matrix);
    _box.getCenter(_position);
    const key = [identityFor(object.material, materialIds, cursor), layout, renderKey(object),
      Math.floor(_position.x / cellSize), Math.floor(_position.y / verticalCellSize),
      Math.floor(_position.z / cellSize)].join('|');
    if (!mergeGroups.has(key)) mergeGroups.set(key, []);
    mergeGroups.get(key).push(entry);
  }
  let mergedBatches = 0, mergedMeshes = 0, mergedVertices = 0;
  function merge(entries) {
    if (entries.length < 2) return;
    // Cloning keeps shared source geometry and any collision users unchanged.
    const copies = entries.map(({ object, matrix }) => object.geometry.clone().applyMatrix4(matrix));
    const geometry = mergeGeometries(copies, false);
    for (const copy of copies) copy.dispose();
    if (!geometry) return;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const batch = new THREE.Mesh(geometry, entries[0].object.material);
    batch.name = `static_merged_${mergedBatches}`;
    copyRenderState(entries[0].object, batch);
    root.add(batch);
    for (const entry of entries) { entry.object.removeFromParent(); entry.batched = true; }
    mergedBatches += 1;
    mergedMeshes += entries.length;
    mergedVertices += geometry.attributes.position.count;
  }
  for (const entries of mergeGroups.values()) {
    let chunk = [], vertices = 0;
    for (const entry of entries) {
      const count = entry.object.geometry.attributes.position.count;
      if (vertices + count > maxMergedVertices) { merge(chunk); chunk = []; vertices = 0; }
      chunk.push(entry); vertices += count;
    }
    merge(chunk);
  }
  root.updateWorldMatrix(true, true);
  freezeStaticTransforms(root);
  let objectsAfter = 0;
  root.traverse((object) => {
    objectsAfter += 1;
  });
  return {
    cellSize,
    inputMeshes: meshes.length,
    batches,
    instances: removedMeshes,
    mergedBatches,
    mergedMeshes,
    mergedVertices,
    retainedMeshes: meshes.length - removedMeshes - mergedMeshes,
    objectsBefore,
    objectsAfter,
  };
}

export default optimizeStaticScene;
