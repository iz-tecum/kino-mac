import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ViewLighting} from '../export/web/view-lighting.js';
const create=()=>new ViewLighting(new THREE.AmbientLight(0xafbac9,.55),new THREE.DirectionalLight(0xe2d7c4,.8));
const bright={ambient:[.3,.25,.16],sunVisibility:1,sunColor:[.91,.86,.73]};
test('weapon room lighting is bounded, smoothly time-based and frozen by pause',()=>{
  const a=create(),b=create();const before=a.snapshot();a.update(bright,0);assert.deepEqual(a.snapshot(),before);
  for(let i=0;i<60;i++)a.update(bright,1/60);for(let i=0;i<30;i++)b.update(bright,1/30);
  assert(Math.abs(a.key.intensity-b.key.intensity)<1e-10);assert(a.key.intensity>.8&&a.key.intensity<1.17);assert(a.ambient.intensity>=.53&&a.ambient.intensity<=.85);
  for(let i=0;i<120;i++)a.update({ambient:[0,0,0],sunVisibility:0,sunColor:bright.sunColor},1/60);
  assert(a.ambient.intensity>=.53);assert(a.key.intensity>=.77);a.reset();assert.deepEqual(a.snapshot(),before);
});

test('sunlit weapon highlights follow world direction through camera turns and freeze during pause',()=>{
  const make=()=>{const key=new THREE.DirectionalLight(0xe2d7c4,.8);key.position.set(0,4,2);return new ViewLighting(new THREE.AmbientLight(0xafbac9,.55),key);};
  const a=make(),b=make(),baseline=a.snapshot(),sunDirection=new THREE.Vector3(1,1,0).normalize();
  const context={sunDirection,cameraQuaternion:new THREE.Quaternion()};
  for(let i=0;i<60;i++)a.update(bright,1/60,context);
  for(let i=0;i<30;i++)b.update(bright,1/30,context);
  assert(a.key.position.distanceTo(b.key.position)<1e-10);
  assert(a.key.position.x>1.8,'light comes from the world sun on the right');
  context.cameraQuaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
  for(let i=0;i<120;i++)a.update(bright,1/60,context);
  assert(a.key.position.x < -1.8,'a half turn moves the same world sun to the left');
  const frozen=a.snapshot();context.cameraQuaternion.identity();a.update(bright,0,context);assert.deepEqual(a.snapshot(),frozen);
  for(let i=0;i<120;i++)a.update({...bright,sunVisibility:0},1/60,context);
  assert(a.key.position.distanceTo(new THREE.Vector3(0,4,2))<.001,'shade restores the established readable fill');
  a.reset();assert.deepEqual(a.snapshot(),baseline);
});
