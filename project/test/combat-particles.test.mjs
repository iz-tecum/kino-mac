import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CombatParticles} from '../export/web/combat-particles.js';

test('Repeated explosion bursts and resets cannot grow scene objects or GPU buffers',()=>{
  const scene=new THREE.Scene(),pool=new CombatParticles(scene,128);
  const geometry=pool.points.geometry,material=pool.points.material,buffer=pool.positions.buffer;
  for(let run=0;run<5;run++){
    for(let frame=0;frame<120;frame++){pool.emit(new THREE.Vector3(frame,30,0),0xffbb44,30);pool.update(1/60,900);assert(pool.active<=128);}
    assert.equal(scene.children.length,1);assert.equal(pool.points.geometry,geometry);assert.equal(pool.points.material,material);assert.equal(pool.positions.buffer,buffer);
    pool.reset();assert.equal(pool.active,0);assert.equal(pool.points.visible,false);
  }
  pool.emit(new THREE.Vector3(10,20,30));pool.update(0,900);const paused=pool.positions.slice();pool.update(0,900);assert.deepEqual(pool.positions,paused);
  pool.update(1,900);assert.equal(pool.active,0);assert.equal(pool.points.visible,false);
});

const random=()=>{let seed=1234;return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);};
test('wall impacts launch into the contacted hemisphere instead of spraying through the wall',()=>{
  const pool=new CombatParticles(new THREE.Scene(),128,random()),normal=new THREE.Vector3(-.6,0,.8),position=new THREE.Vector3(10,20,30);
  pool.emit(position,0xb8a388,128,{kind:'wall',normal});
  for(let i=0;i<128;i++){
    const velocity=new THREE.Vector3().fromArray(pool.velocity,i*3),offset=new THREE.Vector3().fromArray(pool.positions,i*3).sub(position);
    assert(velocity.dot(normal)>20);assert(offset.dot(normal)>.59);assert(pool.sizes[i]>2);
  }
  pool.update(.1,1125);assert.equal(pool.active,128);assert.equal(pool.snapshot().drawCalls,1);assert.equal(pool.snapshot().lastEmission.kind,'wall');
});

test('blood, dust and metal have distinct trajectories and all converge across frame rates',()=>{
  for(const kind of ['blood','wall','metal']){
    const samples=[30,60,120].map(hz=>{const pool=new CombatParticles(new THREE.Scene(),16,random());pool.emit(new THREE.Vector3(10,20,30),0xffffff,16,{kind,direction:new THREE.Vector3(0,0,-1)});for(let n=0;n<hz*.1;n++)pool.update(1/hz,900);return pool;});
    for(const other of samples.slice(1))for(let i=0;i<samples[0].positions.length;i++)assert(Math.abs(samples[0].positions[i]-other.positions[i])<.0001,kind+' trajectory should not change with render rate');
    const pool=samples[0];assert(pool.life.some(n=>n>0));const state=[pool.positions.slice(),pool.velocity.slice(),pool.life.slice()];pool.update(0,900);assert.deepEqual([pool.positions,pool.velocity,pool.life],state,'pause retains particles exactly');
  }
  const dust=new CombatParticles(new THREE.Scene(),1,random()),blood=new CombatParticles(new THREE.Scene(),1,random()),metal=new CombatParticles(new THREE.Scene(),1,random());
  for(const [pool,kind] of [[dust,'wall'],[blood,'blood'],[metal,'metal']])pool.emit(new THREE.Vector3(),0xffffff,1,{kind,normal:new THREE.Vector3(0,0,1)});
  assert(dust.sizes[0]>blood.sizes[0]);assert(metal.velocity[2]>blood.velocity[2]);assert.notEqual(blood.shapes[0],dust.shapes[0]);
});

test('invalid emissions and negative time cannot corrupt the pool, and reset removes all previous-run effects',()=>{
  const scene=new THREE.Scene(),pool=new CombatParticles(scene,64,random()),geometry=pool.geometry,material=pool.material;
  assert.equal(pool.emit({x:NaN,y:0,z:0}),0);assert.equal(pool.emit(new THREE.Vector3(),0xffffff,NaN),0);assert.equal(pool.emit(new THREE.Vector3(),0xffffff,-2),0);
  for(let i=0;i<500;i++)pool.emit(new THREE.Vector3(),0xffcc77,30,{kind:'blast'});pool.update(.01,900);assert.equal(pool.active,64);assert.equal(scene.children.length,1);assert.equal(pool.geometry,geometry);assert.equal(pool.material,material);
  const life=pool.life.slice();pool.update(-1,NaN);assert.deepEqual(pool.life,life);assert.equal(pool.material.uniforms.pixelHeight.value,900);
  pool.reset();assert.equal(pool.snapshot().emitted,0);assert.deepEqual(pool.snapshot().byKind,{});assert.equal(pool.snapshot().lastEmission,null);assert.equal(pool.active,0);assert.equal(pool.points.visible,false);
});
