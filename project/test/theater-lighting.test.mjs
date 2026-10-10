import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { geometryFingerprint } from '../export/web/environment-occlusion.js';
import { installIrradianceMaterial, prepareTheaterLightField } from '../export/web/theater-light-field.js';
import { TheaterLighting } from '../export/web/theater-lighting.js';
import { restoreTheaterFixtures } from '../export/web/theater-fixtures.js';
import { optimizeStaticScene } from '../export/web/scene-optimizer.js';

function triangle(offset = 0, baked = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    offset, 0, 0, offset + 2, 0, 0, offset, 2, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.userData.environmentOcclusion = baked;
  return geometry;
}

function lightData(geometries) {
  const geometry = {}, chunks = [];
  let offset = 0;
  for (const [index, source] of geometries.entries()) {
    const count = source.attributes.position.count;
    const bytes = Uint8Array.from({ length: count * 6 }, (_, i) => (i * 17 + index * 29) % 256);
    geometry[geometryFingerprint(source.attributes.position, source.attributes.normal)] = { count, offset };
    chunks.push(bytes); offset += bytes.length;
  }
  return {
    manifest: { version: 1, byteLength: offset, scale: 3.5, geometry, plan: { sources: [] } },
    binary: Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk))),
  };
}

function shaderFor(material) {
  const shader = {
    uniforms: { unrelatedUniform: { value: 19 } },
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader);
  return shader;
}

test('packed irradiance becomes normalized RGB attributes without changing source bytes', async () => {
  const root = new THREE.Group(), geometry = triangle();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); root.add(mesh);
  const input = lightData([geometry]);
  input.binary.set([0, 127, 255, 255, 64, 0], 0);
  const original = input.binary.slice();
  const field = await prepareTheaterLightField(root, input);
  const base = geometry.getAttribute('kinoBaseLight'), powered = geometry.getAttribute('kinoPowerLight');
  for (const attribute of [base, powered]) {
    assert(attribute.array instanceof Uint8Array);
    assert.equal(attribute.itemSize, 3);
    assert.equal(attribute.count, geometry.attributes.position.count);
    assert.equal(attribute.normalized, true);
    assert.notEqual(attribute.array.buffer, input.binary.buffer);
  }
  assert.deepEqual([base.getX(0), base.getY(0), base.getZ(0)], [0, 127 / 255, 1]);
  assert.deepEqual([powered.getX(0), powered.getY(0), powered.getZ(0)], [1, 64 / 255, 0]);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(Array.from(base.array.slice(i * 3, i * 3 + 3)), Array.from(original.slice(i * 6, i * 6 + 3)));
    assert.deepEqual(Array.from(powered.array.slice(i * 3, i * 3 + 3)), Array.from(original.slice(i * 6 + 3, i * 6 + 6)));
  }
  assert.deepEqual(input.binary, original);
  assert.deepEqual(field.stats, { meshes: 1, vertices: 3, bytes: 18, shaderMaterials: 0 });
});

test('unbaked geometry and missing fingerprints receive neither attributes nor shader hooks', async () => {
  const root = new THREE.Group(), known = triangle(), unknown = triangle(20), unbaked = triangle(40, false);
  const material = new THREE.MeshStandardMaterial();
  const meshes = [known, unknown, unbaked].map(geometry => new THREE.Mesh(geometry, material)); root.add(...meshes);
  const field = await prepareTheaterLightField(root, lightData([known])); field.install(root);
  assert.equal(field.stats.meshes, 1);
  for (const mesh of meshes.slice(1)) {
    assert.equal(mesh.geometry.hasAttribute('kinoBaseLight'), false);
    assert.equal(mesh.geometry.hasAttribute('kinoPowerLight'), false);
    assert.equal(mesh.material, material);
    assert.equal(mesh.material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  }
});

test('irradiance rejects unsupported versions and truncated binary payloads', async () => {
  const root = new THREE.Group(), geometry = triangle(); root.add(new THREE.Mesh(geometry));
  const input = lightData([geometry]);
  await assert.rejects(prepareTheaterLightField(root, { ...input, manifest: { ...input.manifest, version: 2 } }), /Unsupported/);
  await assert.rejects(prepareTheaterLightField(root, { ...input, binary: input.binary.slice(1) }), /length mismatch/);
  assert.equal(geometry.hasAttribute('kinoBaseLight'), false);
});

test('irradiance rejects mismatched vertex counts and binary ranges', async () => {
  for (const invalid of [{ count: 2 }, { offset: -1 }, { offset: 1 }]) {
    const root = new THREE.Group(), geometry = triangle(); root.add(new THREE.Mesh(geometry));
    const input = lightData([geometry]), entry = Object.values(input.manifest.geometry)[0]; Object.assign(entry, invalid);
    await assert.rejects(prepareTheaterLightField(root, input), /geometry mismatch/);
    assert.equal(geometry.hasAttribute('kinoBaseLight'), false);
  }
});

test('irradiance refuses fractional offsets instead of silently converting lighting to zero', async () => {
  const root = new THREE.Group(), geometry = triangle(); root.add(new THREE.Mesh(geometry));
  const input = lightData([geometry]);
  input.binary = Uint8Array.from([...input.binary, 99]); input.manifest.byteLength++;
  Object.values(input.manifest.geometry)[0].offset = .5;
  await assert.rejects(prepareTheaterLightField(root, input), /geometry mismatch|range|offset/i);
});

test('irradiance shader injection preserves original material and shared power uniform', () => {
  const material = new THREE.MeshStandardMaterial({ roughness: .73, metalness: .11, vertexColors: true });
  material.name = 'native theater plaster'; material.userData.source = 'native';
  const power = { value: .25 }, shade = installIrradianceMaterial(material, power, 2.25), shader = shaderFor(shade);
  assert.notEqual(shade, material);
  assert.equal(material.userData.kinoIrradiance, undefined);
  assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  assert.equal(shade.roughness, material.roughness); assert.equal(shade.metalness, material.metalness);
  assert.equal(shade.vertexColors, true); assert.equal(shade.userData.source, 'native');
  assert.equal(shader.uniforms.kinoPower, power);
  assert.equal(shader.uniforms.unrelatedUniform.value, 19);
  assert.match(shader.vertexShader, /attribute vec3 kinoBaseLight/);
  assert.match(shader.vertexShader, /vKinoPowerLight = kinoPowerLight/);
  assert.match(shader.fragmentShader, /irradiance \+= 2\.250 \* PI/);
  assert.match(shader.fragmentShader, /vKinoBaseLight \+ kinoPower \* vKinoPowerLight/);
  power.value = .9; assert.equal(shader.uniforms.kinoPower.value, .9);
  assert.notEqual(shade.customProgramCacheKey(), installIrradianceMaterial(material, power, 4).customProgramCacheKey());
});

test('installation shares one variant per material across baked meshes but isolates unbaked props', async () => {
  const root = new THREE.Group(), a = triangle(), b = triangle(10);
  const shared = new THREE.MeshStandardMaterial(), other = new THREE.MeshStandardMaterial();
  const first = new THREE.Mesh(a, shared), second = new THREE.Mesh(b, [shared, other]);
  const prop = new THREE.Mesh(triangle(30, false), shared); root.add(first, second, prop);
  const field = await prepareTheaterLightField(root, lightData([a, b])); field.install(root);
  assert.equal(first.material, second.material[0]);
  assert.notEqual(first.material, shared); assert.notEqual(second.material[1], other);
  assert.equal(prop.material, shared); assert.equal(shared.userData.kinoIrradiance, undefined);
  assert.equal(field.stats.shaderMaterials, 2);
  assert.equal(shaderFor(first.material).uniforms.kinoPower, shaderFor(second.material[1]).uniforms.kinoPower);
  field.power.value = 1; field.reset(); assert.equal(field.power.value, 0);
});

test('static merging preserves distinct irradiance samples before shader material installation', async () => {
  const root = new THREE.Group(), first = triangle(10), second = triangle(30), material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(first, material), b = new THREE.Mesh(second, material);
  a.position.set(15, 10, 15); b.position.set(20, 10, 15); root.add(a, b);
  const field = await prepareTheaterLightField(root, lightData([first, second]));
  const expected = Object.fromEntries(['kinoBaseLight', 'kinoPowerLight'].map(name => [name,
    [...first.attributes[name].array, ...second.attributes[name].array]]));
  assert.equal(material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  const result = optimizeStaticScene(root); assert.equal(result.mergedMeshes, 2);
  const merged = root.children.find(mesh => mesh.name.startsWith('static_merged_')); assert(merged);
  assert.equal(merged.material, material);
  for (const name of Object.keys(expected)) {
    const attribute = merged.geometry.attributes[name];
    assert.deepEqual(Array.from(attribute.array), expected[name]);
    assert.equal(attribute.count, merged.geometry.attributes.position.count);
    assert.equal(attribute.normalized, true); assert.equal(attribute.itemSize, 3);
  }
  field.install(root);
  assert.equal(merged.material.userData.kinoIrradiance, true);
  assert.equal(field.stats.shaderMaterials, 1);
  assert.equal(shaderFor(merged.material).uniforms.kinoPower, field.power);
});

test('static instancing retains the normalized irradiance buffers and gets its shader after batching', async () => {
  const root = new THREE.Group(), geometry = triangle(), material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material); b.position.x = 4; root.add(a, b);
  const field = await prepareTheaterLightField(root, lightData([geometry]));
  const buffer = geometry.attributes.kinoBaseLight;
  const result = optimizeStaticScene(root); assert.equal(result.instances, 2);
  const batch = root.children.find(mesh => mesh.isInstancedMesh); assert(batch);
  assert.equal(batch.geometry.attributes.kinoBaseLight, buffer); assert.equal(batch.material, material);
  field.install(root); assert.equal(batch.material.userData.kinoIrradiance, true);
  assert.equal(shaderFor(batch.material).uniforms.kinoPower, field.power);
});

function source(x, { powered = false, glowRadius = 0, radius = 700 } = {}) {
  return { position: [x, 0, 0], color: [.8, .7, .5], radius, energy: 1, powered, glowRadius };
}

function lightingFixture(sources, lineClear = () => true) {
  const scene = new THREE.Scene(), power = { value: 0 }, calls = [];
  const field = { manifest: { plan: { sources } }, power, reset() { power.value = 0; } };
  const world = { lightfield: field, lineClear(from, to) { calls.push([from.toArray(), to.toArray()]); return lineClear(from, to); } };
  const lighting = new TheaterLighting(scene); lighting.bind(world);
  return { lighting, field, scene, calls };
}

test('power fade advances on simulation time, holds while paused, and shares the glow uniform', () => {
  const { lighting, field } = lightingFixture([source(20, { powered: true, glowRadius: 2 })]);
  const actor = new THREE.Vector3();
  lighting.update(actor, false, 70); assert.equal(field.power.value, 0);
  lighting.update(actor, true, 100); assert.equal(field.power.value, 0);
  lighting.update(actor, true, 100.8); assert(Math.abs(field.power.value - .5) < 1e-10);
  const paused = lighting.snapshot(), intensity = lighting.pool[0].intensity;
  for (let i = 0; i < 10; i++) lighting.update(actor, true, 100.8, { pixelHeight: 1200 });
  assert.deepEqual(lighting.snapshot(), paused); assert.equal(lighting.pool[0].intensity, intensity);
  assert.equal(lighting.glowMaterial.uniforms.power, field.power);
  assert.equal(lighting.glowMaterial.uniforms.pixelHeight.value, 1200);
  lighting.update(actor, true, 101.6); assert.equal(field.power.value, 1);
  assert.equal(lighting.pool[0].intensity, 32);
});

test('reset removes powered accents and starts a fresh fade at the next run time', () => {
  const { lighting, field } = lightingFixture([source(20, { powered: true, glowRadius: 2 })]);
  const actor = new THREE.Vector3(); lighting.update(actor, true, 100); lighting.update(actor, true, 102);
  assert.equal(lighting.snapshot().activeAccents, 1);
  lighting.reset(); assert.equal(field.power.value, 0); assert.equal(lighting.snapshot().activeAccents, 0);
  lighting.update(actor, false, 0); assert.equal(lighting.snapshot().activeAccents, 0);
  lighting.update(actor, true, 2); assert.equal(field.power.value, 0);
  lighting.update(actor, true, 2.8); assert(Math.abs(field.power.value - .5) < 1e-10);
});

test('accent selection skips occluded sources before taking four visible nearby lights', () => {
  const { lighting, calls } = lightingFixture([source(1), source(2), source(3), source(4), source(5), source(6), source(7), source(901)],
    (_, to) => to.x >= 3);
  const actor = new THREE.Vector3(); lighting.update(actor, false, 0);
  assert.deepEqual(lighting.pool.map(light => light.position.x), [3, 4, 5, 6]);
  assert.equal(lighting.snapshot().activeAccents, 4);
  assert(calls.some(([, to]) => to[0] === 1)); assert(calls.some(([, to]) => to[0] === 6));
  assert(!calls.some(([, to]) => to[0] === 901));
  for (const [from] of calls) assert.deepEqual(from, actor.toArray());
});

test('unpowered practicals remain visible while powered and fully occluded accents stay off', () => {
  const { lighting } = lightingFixture([source(1, { powered: true }), source(2), source(3)], (_, to) => to.x === 2);
  const actor = new THREE.Vector3(); lighting.update(actor, false, 0);
  assert.equal(lighting.snapshot().activeAccents, 1); assert.equal(lighting.pool[0].position.x, 2);
  lighting.update(new THREE.Vector3(2000, 0, 0), true, 1);
  assert.equal(lighting.snapshot().activeAccents, 0);
});

function fixtureScene() {
  const root = new THREE.Group();
  const template = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial());
  template.name = 'i_p_glo_stage_light_17'; template.position.set(10, 20, 30);
  template.scale.set(1.5, 2, .75); template.rotation.set(.3, .7, .2); root.add(template);
  const data = { entities: [
    { id: 2715, classname: 'misc_modle', model: 'p_glo_stage_light', position: [200, 140, -350], yaw: Math.PI / 2 },
    { id: 2727, model: 'lights_hang_single', position: [177, 322, 768], yaw: 0 },
    { id: 2771, model: 'zombie_theater_chandelier1_off', position: [-1, 840, -414], yaw: 0 },
  ] };
  return { root, template, data };
}

test('entity 2715 is restored from native geometry/material and original fixture scale without altering baked props', () => {
  const { root, template, data } = fixtureScene(), sourceMatrix = template.matrix.clone();
  const result = restoreTheaterFixtures(root, data), restored = root.getObjectByName('restored_stage_fixture_2715');
  assert.deepEqual(result.restored, [2715]); assert(restored); assert.equal(root.children.length, 2);
  assert.equal(restored.geometry, template.geometry); assert.equal(restored.material, template.material);
  assert.deepEqual(restored.scale.toArray(), [1.5, 2, .75]);
  assert.deepEqual(restored.position.toArray(), data.entities[0].position);
  assert(restored.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)) < 1e-7);
  assert.equal(restored.matrixAutoUpdate, true);
  assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(restored.matrix).toArray(), data.entities[0].position);
  assert.deepEqual(template.position.toArray(), [10, 20, 30]); assert.deepEqual(template.matrix, sourceMatrix);
  assert.equal(template.parent, root);
});

test('fixture restoration is a no-op when entity or native template is unavailable', () => {
  const { root, data } = fixtureScene();
  assert.deepEqual(restoreTheaterFixtures(root, { entities: data.entities.slice(1) }).restored, []);
  assert.equal(root.children.length, 1);
  const empty = new THREE.Group(); assert.deepEqual(restoreTheaterFixtures(empty, data).restored, []);
  assert.equal(empty.children.length, 0);
});

test('repeated fixture restoration cannot add a second entity 2715', () => {
  const { root, data } = fixtureScene(); restoreTheaterFixtures(root, data);
  const second = restoreTheaterFixtures(root, data);
  assert.deepEqual(second.restored, []);
  assert.equal(root.children.filter(object => object.name === 'restored_stage_fixture_2715').length, 1);
});

test('an already baked native fixture at entity 2715 is not duplicated', () => {
  const { root, template, data } = fixtureScene();
  template.position.fromArray(data.entities[0].position); template.updateMatrix();
  const result = restoreTheaterFixtures(root, data);
  assert.deepEqual(result.restored, []); assert.equal(root.children.length, 1);
});

test('creature probe fill is shared only among actor clones and does not alter world materials',()=>{
  const lighting=new TheaterLighting(new THREE.Scene()),material=new THREE.MeshStandardMaterial(),a=new THREE.Mesh(triangle(),material),b=new THREE.Mesh(triangle(),material);
  lighting.prepareActors({templates:[a,b],heads:[]});
  assert.notEqual(a.material,material);assert.equal(a.material,b.material);assert.equal(material.userData.kinoActorProbe,undefined);
  assert.equal(a.material.userData.kinoActorProbe,true);
  const shader={fragmentShader:'#include <lights_fragment_maps>'};a.material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader,/irradiance \+= PI/);assert.equal(a.material.emissiveIntensity,material.emissiveIntensity);
});

test('separate solar samples stay aligned with baked vertices and count toward the memory budget',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const root=new THREE.Group(),g=triangle();root.add(new THREE.Mesh(g,new THREE.MeshStandardMaterial()));
 const input=lightData([g]),solar=Uint8Array.from([1,2,3,4,5,6,7,8,9]);
 Object.assign(input.manifest,{solarBinary:'solar.bin',solarByteLength:9});
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>solar.buffer});
 const field=await prepareTheaterLightField(root,input);
 assert.deepEqual(Array.from(g.attributes.kinoSolarLight.array),Array.from(solar));
 assert.equal(g.attributes.kinoSolarLight.normalized,true);assert.equal(field.stats.bytes,27);
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
 await assert.rejects(prepareTheaterLightField(new THREE.Group(),input),/Solar light buffer length mismatch/);
});
