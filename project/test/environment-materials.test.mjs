import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { configureEnvironmentNormal, enhanceEnvironmentMaterials } from '../export/web/environment-materials.js';
import { applyEnvironmentOcclusion, geometryFingerprint, geometryWithOcclusion } from '../export/web/environment-occlusion.js';

const web = new URL('../export/web/', import.meta.url);
function map(name = 'textures/~-gtheater_column_set_1_c.png') { const texture = new THREE.Texture(); texture.name = name; texture.flipY = false; return texture; }
function triangle() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 0, 2, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 1], 2));
  geometry.setIndex([0, 1, 2]); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
const entry = { normal: 'native-normal.png', sourceNormal: 'textures/source-normal.png',
  roughness: .63, metalness: 0, normalScale: [.85, -.85], pairing: 'exact-image-stem', surface: 'ornament' };
const manifest = { version: 1, materials: { 'textures/~-gtheater_column_set_1_c.png': entry } };

test('normal sampler preserves glTF UV transform, wrapping and linear normal data', () => {
  const albedo = map(); albedo.channel = 1;
  albedo.wrapS = THREE.RepeatWrapping; albedo.wrapT = THREE.MirroredRepeatWrapping;
  albedo.offset.set(.2, -.3); albedo.repeat.set(2, 3); albedo.rotation = .7; albedo.center.set(.4, .6);
  albedo.updateMatrix(); albedo.matrixAutoUpdate = false;
  const normal = configureEnvironmentNormal(new THREE.Texture(), albedo, 8);
  assert.equal(normal.flipY, false); assert.equal(normal.channel, 1);
  assert.equal(normal.wrapS, albedo.wrapS); assert.equal(normal.wrapT, albedo.wrapT);
  assert.deepEqual(normal.matrix.elements, albedo.matrix.elements);
  assert.deepEqual(normal.repeat.toArray(), [2, 3]); assert.deepEqual(normal.offset.toArray(), [.2, -.3]);
  assert.equal(normal.colorSpace, THREE.NoColorSpace); assert.equal(normal.anisotropy, 4);
  assert.notEqual(normal.matrix, albedo.matrix);
});

test('native normals retain shared material identity and immutable map/geometry buffers', async () => {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial({ map: map() }), geometry = triangle();
  const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, material);
  second.position.set(20, 3, 5); root.add(first, second);
  const initialPositions = [...geometry.attributes.position.array], initialUVs = [...geometry.attributes.uv.array], albedo = material.map;
  let loads = 0;
  const stats = await enhanceEnvironmentMaterials(root, { manifest, loadTexture: async url => { assert.equal(url, entry.normal); loads++; return new THREE.Texture(); } });
  assert.equal(loads, 1); assert.equal(stats.materials, 1); assert.equal(stats.textures, 1);
  assert.equal(first.material, second.material); assert.equal(material.map, albedo); assert.equal(first.geometry, geometry);
  assert.deepEqual([...geometry.attributes.position.array], initialPositions); assert.deepEqual([...geometry.attributes.uv.array], initialUVs);
  assert.deepEqual(second.position.toArray(), [20, 3, 5]);
  assert.deepEqual(material.normalScale.toArray(), [.85, -.85]); assert.equal(material.roughness, .63);
  assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
});

test('material enhancement leaves hidden helpers, skinned, transparent and custom-shader meshes alone', async () => {
  const root = new THREE.Group(), objects = [];
  for (const kind of ['hidden', 'collision', 'skin', 'transparent', 'existing', 'custom']) {
    const material = new THREE.MeshStandardMaterial({ map: map() });
    const mesh = kind === 'skin' ? new THREE.SkinnedMesh(triangle(), material) : new THREE.Mesh(triangle(), material);
    if (kind === 'hidden') mesh.visible = false;
    if (kind === 'collision') mesh.userData.collisionOnly = true;
    if (kind === 'transparent') material.transparent = true;
    if (kind === 'existing') material.normalMap = new THREE.Texture();
    if (kind === 'custom') material.onBeforeCompile = () => {};
    objects.push({ mesh, original: material.normalMap }); root.add(mesh);
  }
  await enhanceEnvironmentMaterials(root, { manifest, loadTexture: async () => { throw new Error('Excluded texture loaded'); } });
  for (const { mesh, original } of objects) { assert.equal(mesh.material.normalMap, original); assert.equal(mesh.material.roughness, 1); }
});

test('contact colors multiply existing linear RGB, preserve alpha, bounds, groups and every source buffer', () => {
  const source = triangle(); source.addGroup(0, 3, 0);
  source.setAttribute('color', new THREE.Float32BufferAttribute([.8, .4, .2, .3, .6, .5, .4, .8, 1, .8, .3, 1], 4));
  const original = [...source.attributes.color.array], result = geometryWithOcclusion(source, new Uint8Array([128, 255, 192]));
  assert.notEqual(result, source); assert.equal(result.attributes.position, source.attributes.position);
  assert.equal(result.attributes.normal, source.attributes.normal); assert.equal(result.attributes.uv, source.attributes.uv); assert.equal(result.index, source.index);
  assert.deepEqual(result.boundingBox, source.boundingBox); assert.deepEqual(result.boundingSphere, source.boundingSphere);
  assert.deepEqual(result.groups, source.groups); assert.notEqual(result.groups, source.groups);
  assert(result.attributes.color.array instanceof Uint8Array); assert.equal(result.attributes.color.normalized, true);
  for (let i = 0; i < 3; i++) for (let channel = 0; channel < 4; channel++) {
    const expected = original[i * 4 + channel] * (channel < 3 ? [128, 255, 192][i] / 255 : 1);
    assert(Math.abs(result.attributes.color.array[i * 4 + channel] / 255 - expected) < 1 / 255);
  }
  assert.deepEqual([...source.attributes.color.array], original);
  assert.throws(() => geometryWithOcclusion(source, new Uint8Array(2)), /vertex count/);
});

test('contact bake preserves HDR colors instead of clipping to byte range', () => {
  const source = triangle(); source.setAttribute('color', new THREE.Float32BufferAttribute([2, .5, .2, 1, 1, 1, 1, 1, 1], 3));
  const result = geometryWithOcclusion(source, new Uint8Array([192, 255, 255]));
  assert(result.attributes.color.array instanceof Float32Array);
  assert(Math.abs(result.attributes.color.getX(0) - 2 * 192 / 255) < 1e-6);
});

test('contact bake applies only to unchanged world-shell vertices and excludes moving or masked surfaces', async () => {
  const root = new THREE.Group(); root.name = 'world_shell';
  const source = triangle(), fingerprint = geometryFingerprint(source.attributes.position, source.attributes.normal);
  const stable = new THREE.Mesh(source, new THREE.MeshStandardMaterial()); root.add(stable);
  const excluded = [];
  for (const kind of ['dynamic', 'hidden', 'collision', 'transparent', 'masked', 'changed']) {
    const geometry = source.clone(), material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, material); root.add(mesh); excluded.push(mesh);
    if (kind === 'dynamic') mesh.userData.dynamicBrush = true;
    if (kind === 'hidden') mesh.visible = false;
    if (kind === 'collision') mesh.userData.collisionOnly = true;
    if (kind === 'transparent') material.transparent = true;
    if (kind === 'masked') material.alphaTest = .45;
    if (kind === 'changed') geometry.attributes.position.setX(0, 100);
  }
  const stats = await applyEnvironmentOcclusion(root, { manifest: { version: 1, byteLength: 3, geometry: { [fingerprint]: { count: 3, offset: 0 } } }, binary: new Uint8Array([128, 200, 255]) });
  assert.equal(stats.meshes, 1); assert.equal(stats.vertices, 3); assert.equal(stats.colorBytes, 9);
  assert.equal(stable.material.vertexColors, true); assert.equal(stable.geometry.attributes.color.getX(0), 128 / 255);
  for (const mesh of excluded) { assert.equal(mesh.geometry.attributes.color, undefined); assert.equal(mesh.material.vertexColors, false); }
});

test('AO variants do not enable vertex colors on an uncolored door sharing the source material', async () => {
  const root = new THREE.Group(); root.name = 'world_shell';
  const geometry = triangle(), material = new THREE.MeshStandardMaterial({ map: map() });
  const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, material), door = new THREE.Mesh(geometry, material);
  door.userData.dynamicBrush = true; root.add(first, second, door);
  const fingerprint = geometryFingerprint(geometry.attributes.position, geometry.attributes.normal);
  await applyEnvironmentOcclusion(root, { manifest: { version: 1, byteLength: 3, geometry: { [fingerprint]: { count: 3, offset: 0 } } }, binary: new Uint8Array([128, 200, 255]) });
  assert.notEqual(first.material, material); assert.equal(first.material, second.material);
  assert.equal(first.material.map, material.map); assert.equal(first.material.vertexColors, true);
  assert.equal(door.material, material); assert.equal(material.vertexColors, false);
  assert.equal(door.geometry.attributes.color, undefined);
});

test('generated native-normal and contact assets have verifiable provenance and bounded storage', () => {
  const materialManifest = JSON.parse(fs.readFileSync(new URL('environment-materials.json', web)));
  assert(Object.keys(materialManifest.materials).length > 100);
  assert(materialManifest.estimatedGpuBytesWithMipmaps < 64 * 1024 * 1024);
  for (const [filename, texture] of Object.entries(materialManifest.textures)) {
    for (const [relative, expected] of [[texture.source, texture.sourceSha256], ['environment/normals/' + filename, texture.outputSha256]]) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(relative, web))).digest('hex'), expected);
    }
    assert(texture.size.every(size => size <= 512));
  }
  const ao = JSON.parse(fs.readFileSync(new URL('environment-occlusion.json', web))), binary = fs.readFileSync(new URL(ao.binary, web));
  assert.equal(binary.byteLength, ao.byteLength); assert(binary.byteLength < 1024 * 1024);
  assert.equal(crypto.createHash('sha256').update(binary).digest('hex'), ao.provenance.outputSha256);
  assert(ao.stats.min >= .5); assert(ao.stats.mean < .99); assert(ao.stats.max <= 1);
  assert.equal(Object.values(ao.geometry).reduce((n, entry) => n + entry.count, 0), binary.length);
});
