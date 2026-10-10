import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {surfaceReceivers,receiverAt,installSurfaceSunlight,loadSurfaceSunlight} from '../export/web/theater-surface-light.js';
import {installIrradianceMaterial} from '../export/web/theater-light-field.js';
const plan=JSON.parse(fs.readFileSync(new URL('../export/web/theater-surface-light.json',import.meta.url)));
test('receiver selection excludes walls, floors above and the uncharted map',()=>{
 assert.equal(receiverAt(new THREE.Vector3(0,80,1100),new THREE.Vector3(0,1,0)),0);
 assert.equal(receiverAt(new THREE.Vector3(0,80,1100),new THREE.Vector3(1,0,0)),-1);
 assert.equal(receiverAt(new THREE.Vector3(0,304,1100),new THREE.Vector3(0,1,0)),-1);
 assert.equal(receiverAt(new THREE.Vector3(0,-64,-700),new THREE.Vector3(0,1,0)),3);
 assert.equal(receiverAt(new THREE.Vector3(99999,0,0),new THREE.Vector3(0,1,0)),-1);
});
test('surface sunlight composes with powered irradiance and safely expresses below-zero elevations',()=>{
 const power={value:.5},shade=installIrradianceMaterial(new THREE.MeshStandardMaterial(),power,3.25),texture=new THREE.Texture();
 installSurfaceSunlight(shade,{plan,texture},3.25);
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};shade.onBeforeCompile(shader);
 assert.equal(shader.uniforms.kinoPower,power);assert.equal(shader.uniforms.kinoSurfaceSun.value,texture);
 assert.match(shader.fragmentShader,/y-\(-64\.00\)/);assert.doesNotMatch(shader.fragmentShader,/y--/);
 assert.equal((shader.fragmentShader.match(/irradiance-=PI\*3.250\*kinoSolar/g)||[]).length,6);
 assert.match(shader.fragmentShader,/vKinoBaseLight \+ kinoPower \* vKinoPowerLight/);
 assert.match(shader.vertexShader,/kinoSolar=kinoSolarLight/);
});
test('packaged sun atlas matches all receivers, its source buffers and its bounded texture budget',()=>{
 const root=new URL('../export/web/',import.meta.url),bytes=fs.readFileSync(new URL(plan.binary,root));
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 assert.equal(bytes.length,1572864);assert.equal(hash(bytes),plan.provenance.binary);
 assert.equal(hash(fs.readFileSync(new URL('kino.bin',root))),plan.provenance.world);
 assert.equal(hash(fs.readFileSync(new URL('kino.gltf',root))),plan.provenance.gltf);
 for(const [i,r]of plan.regions.entries()) {assert.deepEqual(r.bounds,surfaceReceivers[i].bounds);assert.equal(r.height,surfaceReceivers[i].height);assert(r.litPixels>0);assert(r.litPixels<512*512);}
 assert.equal(plan.geometry.unsupportedTextures.length,0);assert(plan.geometry.staticInstances>3000);
});
test('malformed receiver data and truncated atlas fail before rendering',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async()=>({ok:true,json:async()=>({...plan,regions:plan.regions.map((r,i)=>i===0?{...r,height:99}:r)})});
 await assert.rejects(loadSurfaceSunlight(),/receiver mismatch/);
 globalThis.fetch=async url=>url.endsWith('.json')?{ok:true,json:async()=>plan}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
 await assert.rejects(loadSurfaceSunlight(),/length mismatch/);
});
