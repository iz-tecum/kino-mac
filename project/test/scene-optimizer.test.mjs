import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { optimizeStaticScene } from '../export/web/scene-optimizer.js';

function triangle(offset = 0) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    offset, 0, 0, offset + 2, 0, 0, offset, 2, 1,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, -1 / Math.sqrt(5), 2 / Math.sqrt(5),
    0, -1 / Math.sqrt(5), 2 / Math.sqrt(5),
    0, -1 / Math.sqrt(5), 2 / Math.sqrt(5),
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute([255, 0, 64, 32, 255, 0, 0, 16, 255], 3, true));
  geometry.setAttribute('tangent', new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

function close(actual, expected, tolerance = 0.00002) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) < tolerance,
    `component ${i}: ${value} != ${expected[i]}`));
}

function vertices(root) {
  root.updateWorldMatrix(true, true);
  const result = [];
  root.traverseVisible(object => {
    if (!object.isMesh) return;
    const matrices = object.isInstancedMesh ? Array.from({ length: object.count }, (_, i) => {
      const instance = new THREE.Matrix4(); object.getMatrixAt(i, instance);
      return new THREE.Matrix4().multiplyMatrices(object.matrixWorld, instance);
    }) : [object.matrixWorld];
    for (const matrix of matrices) {
      const geometry = object.geometry, normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
      const { position, normal, uv, color, tangent } = geometry.attributes;
      const indices = geometry.index?.array ?? Array.from({ length: position.count }, (_, i) => i);
      for (const index of indices) result.push({
        position: new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(matrix).toArray(),
        normal: new THREE.Vector3().fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix).toArray(),
        uv: [uv.getX(index), uv.getY(index)],
        color: [color.getX(index), color.getY(index), color.getZ(index)],
        tangent: [...new THREE.Vector3().fromBufferAttribute(tangent, index).transformDirection(matrix).toArray(), tangent.getW(index)],
      });
    }
  });
  return result;
}

test('merged meshes preserve rendered triangles, world normals, UVs, colors, tangents, and source buffers', () => {
  const root = new THREE.Group(), parent = new THREE.Group();
  root.position.set(37, 14, 83); root.rotation.set(.2, -.3, .1); root.scale.set(1.2, .7, 1.8);
  parent.position.set(100, 20, 100); parent.rotation.y = .2;
  root.add(parent);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const a = new THREE.Mesh(triangle(), material), b = new THREE.Mesh(triangle(5), material);
  a.rotation.set(.4, .5, -.1); a.scale.set(2, 3, .5);
  b.position.set(8, 2, 3); b.rotation.set(-.2, .3, .6); b.scale.set(.5, 2, 4);
  parent.add(a, b);
  const originals = [a, b].map(mesh => Array.from(mesh.geometry.attributes.position.array));
  const before = vertices(root), beforeBox = new THREE.Box3().setFromObject(root, true);
  const stats = optimizeStaticScene(root);
  assert.equal(stats.mergedMeshes, 2); assert.equal(stats.mergedBatches, 1);
  const batch = root.children.find(object => object.name.startsWith('static_merged_'));
  assert.equal(batch.material, material);
  assert.equal(batch.geometry.attributes.position.count, 6);
  assert.equal(batch.geometry.index.count, 6);
  assert.equal(batch.geometry.attributes.color.normalized, true);
  assert(batch.geometry.attributes.color.array instanceof Uint8Array);
  const after = vertices(root);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) for (const key of Object.keys(before[i])) close(after[i][key], before[i][key]);
  const afterBox = new THREE.Box3().setFromObject(root, true);
  close(afterBox.min.toArray(), beforeBox.min.toArray()); close(afterBox.max.toArray(), beforeBox.max.toArray());
  for (let i = 0; i < batch.geometry.attributes.position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(batch.geometry.attributes.position, i);
    assert(batch.geometry.boundingBox.containsPoint(point));
    assert(point.distanceTo(batch.geometry.boundingSphere.center) <= batch.geometry.boundingSphere.radius + 0.00001);
  }
  assert.deepEqual(Array.from(a.geometry.attributes.position.array), originals[0]);
  assert.deepEqual(Array.from(b.geometry.attributes.position.array), originals[1]);
});

test('repeated geometry remains instanced instead of expanding its vertex storage', () => {
  const root = new THREE.Group(), geometry = triangle(), material = new THREE.MeshBasicMaterial();
  for (let i = 0; i < 5; i++) { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(i * 3 + 20, 20, 20); root.add(mesh); }
  const before = vertices(root), stats = optimizeStaticScene(root);
  assert.equal(stats.batches, 1); assert.equal(stats.instances, 5); assert.equal(stats.mergedMeshes, 0);
  const batch = root.children[0]; assert(batch.isInstancedMesh); assert.equal(batch.geometry, geometry);
  assert.equal(batch.count, 5); assert.equal(batch.geometry.attributes.position.count, 3);
  const after = vertices(root); assert.equal(after.length, 15);
  after.forEach((vertex, i) => close(vertex.position, before[i].position));
});

test('spatial merge cells use geometry bounds, and distinct material identities stay separate', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const meshes = [new THREE.Mesh(triangle(10), material), new THREE.Mesh(triangle(15), material),
    new THREE.Mesh(triangle(2000), material), new THREE.Mesh(triangle(20), material.clone())];
  root.add(...meshes);
  const stats = optimizeStaticScene(root, { cellSize: 100 });
  assert.equal(stats.mergedMeshes, 2); assert.equal(root.children.length, 3);
  assert.equal(meshes[2].parent, root); assert.equal(meshes[3].parent, root);
});

test('index topology is preserved and vertices are offset when concatenated', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const first = new THREE.PlaneGeometry(2, 2), second = new THREE.PlaneGeometry(4, 2);
  const a = new THREE.Mesh(first, material), b = new THREE.Mesh(second, material);
  a.position.set(20, 20, 20); b.position.set(30, 20, 20); root.add(a, b);
  const sourceIndices = [...first.index.array, ...Array.from(second.index.array, value => value + 4)];
  const stats = optimizeStaticScene(root);
  assert.equal(stats.mergedVertices, 8);
  const batch = root.children[0]; assert.equal(batch.geometry.index.count / 3, 4);
  assert.deepEqual(Array.from(batch.geometry.index.array), sourceIndices);
});

test('draw groups, partial draw ranges, incompatible attributes, and render state are retained', () => {
  const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const grouped = triangle(); grouped.addGroup(0, 3, 0);
  const partial = triangle(); partial.setDrawRange(0, 0);
  const a = new THREE.Mesh(grouped, material), b = new THREE.Mesh(partial, material);
  const c = new THREE.Mesh(triangle(), material); c.geometry.deleteAttribute('color');
  const d = new THREE.Mesh(triangle(), material); d.castShadow = true;
  const e = new THREE.Mesh(triangle(), material); e.layers.set(2);
  const f = new THREE.Mesh(triangle(), material); f.renderOrder = 2;
  const g = new THREE.Mesh(triangle(), material); g.frustumCulled = false;
  root.add(a, b, c, d, e, f, g);
  const stats = optimizeStaticScene(root);
  assert.equal(stats.mergedMeshes, 0); assert.equal(stats.instances, 0);
  assert.equal(a.geometry, grouped); assert.deepEqual(grouped.groups, [{ start: 0, count: 3, materialIndex: 0 }]);
  assert.equal(b.geometry.drawRange.count, 0); assert.equal(root.children.length, 7);
});

test('hidden, dynamic, collision, animated, skinned, and descendant-bearing objects are not detached or frozen', () => {
  const root = new THREE.Group(), geometry = triangle(), material = new THREE.MeshBasicMaterial();
  for (const flags of [{ visible: false }, { userData: { dynamicBrush: true } },
    { userData: { collisionOnly: true } }, { animations: [new THREE.AnimationClip('move', 1, [])] }]) {
    const group = Object.assign(new THREE.Group(), flags);
    const child = new THREE.Mesh(geometry, material); group.add(child); root.add(group);
  }
  const withChild = new THREE.Mesh(geometry, material), hiddenChild = new THREE.Mesh(geometry, material);
  hiddenChild.visible = false; withChild.add(hiddenChild); root.add(withChild);
  const skinned = new THREE.SkinnedMesh(geometry, material); root.add(skinned);
  const before = [...root.children], stats = optimizeStaticScene(root);
  assert.equal(stats.inputMeshes, 0); assert.deepEqual(root.children, before);
  assert.equal(hiddenChild.parent, withChild);
  for (const object of before) assert.equal(object.matrixAutoUpdate, true);
  for (const group of before.slice(0, 4)) assert.equal(group.children[0].matrixAutoUpdate, true);
});

test('transparent, custom shader, custom render hook, morph, mirrored, and singular meshes are excluded', () => {
  const root = new THREE.Group(), geometry = triangle(), material = new THREE.MeshBasicMaterial();
  const transparent = material.clone(); transparent.transparent = true;
  const custom = material.clone(); custom.onBeforeCompile = () => {};
  const meshes = [new THREE.Mesh(geometry, transparent), new THREE.Mesh(geometry, custom),
    new THREE.Mesh(geometry, new THREE.ShaderMaterial()), new THREE.Mesh(geometry, material),
    new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)];
  meshes[3].onBeforeRender = () => {};
  meshes[4].scale.x = -1; meshes[5].scale.x = 0;
  const morphGeometry = triangle(); morphGeometry.morphAttributes.position = [triangle(1).attributes.position];
  const morph = new THREE.Mesh(morphGeometry, material); meshes.push(morph);
  root.add(...meshes); const stats = optimizeStaticScene(root);
  assert.equal(stats.inputMeshes, 0); assert.equal(root.children.length, meshes.length);
});

test('merge budget bounds allocations and the diagnostic opt-out keeps distinct meshes', () => {
  const material = new THREE.MeshBasicMaterial(), root = new THREE.Group();
  for (let i = 0; i < 5; i++) root.add(new THREE.Mesh(triangle(i), material));
  const stats = optimizeStaticScene(root, { maxMergedVertices: 6 });
  assert.equal(stats.mergedBatches, 2); assert.equal(stats.mergedMeshes, 4);
  assert.equal(root.children.length, 3);
  for (const child of root.children) assert(child.geometry.attributes.position.count <= 6);
  const other = new THREE.Group(); other.add(new THREE.Mesh(triangle(), material), new THREE.Mesh(triangle(1), material));
  assert.equal(optimizeStaticScene(other, { mergeStatic: false }).mergedMeshes, 0);
  assert.equal(other.children.length, 2);
});
