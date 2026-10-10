import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WeaponMotion} from '../export/web/weapon-motion.js';
import {ViewWeapon,Rig} from '../export/web/animation.js';
import {NativeAimPose} from '../export/web/weapon-pose.js';
const close=(a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('locomotion phase follows actual travel continuously across walk, sprint, walls and air',()=>{
  const motion=new WeaponMotion();motion.update(1,{speed:190});
  const phase=motion.phase,before=motion.offset.slice();motion.update(0,{speed:285});
  assert.deepEqual(motion.offset,before);assert.equal(motion.phase,phase,'changing speed cannot jump the pose');
  motion.update(.01,{speed:285});close(motion.phase-phase,.135);
  const stop=motion.phase;motion.update(.5,{speed:0});close(motion.phase,stop);assert(motion.weight<.002,'held input against a wall produces no sustained bob');
  motion.update(.5,{speed:285,grounded:false});assert(motion.weight<.00001,'airborne travel does not become a walking cycle');
});

test('secondary recoil has the same recovery at 30, 60 and 144 Hz without altering the aim camera',()=>{
  const results=[30,60,144].map(hz=>{const motion=new WeaponMotion();motion.fire();for(let i=0;i<hz/2;i++)motion.update(1/hz,{speed:190});return motion.snapshot();});
  for(const sample of results.slice(1)){close(sample.kick,results[0].kick,1e-10);close(sample.phase,results[0].phase);close(sample.offset[0],results[0].offset[0]);}
  assert(results[0].kick<.000001,'recoil returns fully to rest within half a second');
  const motion=new WeaponMotion();for(let i=0;i<40;i++)motion.fire();assert(motion.kick<=.35,'rapid automatic fire cannot drive the weapon through the camera');
  let previous=motion.kick;for(let i=0;i<100;i++){motion.update(.005);assert(motion.kick>=0&&motion.kick<=previous);previous=motion.kick;}
});

test('pause, ADS, motion setting and equip reset preserve steady native sight alignment',()=>{
  const motion=new WeaponMotion();motion.fire();motion.update(.04,{speed:190});const before=motion.snapshot();motion.update(0,{speed:190});assert.deepEqual(motion.snapshot(),before);
  motion.update(.03,{speed:190,aim:1});close(motion.offset[0],0);close(motion.offset[1],0);assert(motion.offset[2]<motion.kick,'aiming attenuates only secondary kick');
  motion.update(.1,{speed:285,enabled:false});close(motion.offset[0],0);close(motion.offset[1],0);
  motion.reset();assert.deepEqual(motion.offset,[0,0,0]);assert.equal(motion.kick,0);assert.equal(motion.phase,0);
});

function reloadFixture(){
  const notes=[],view=new ViewWeapon(new THREE.Scene(),{});view.ready=true;view.def={adsInTime:.2,adsOutTime:.2};view.root=new THREE.Group();view.rig=new Rig(view.root,name=>notes.push(name));view.knives={};view.aimPose=new NativeAimPose(view.root);
  view.rig.add('idleAnim',{name:'idle',fps:30,duration:1,bones:[],notifies:[]});
  view.rig.add('reloadAnim',{name:'reload',fps:30,duration:1,bones:[],notifies:[{time:.4,name:'mag-in'},{time:.99,name:'finished'}]});
  view.reloadProps={begin(){},set(){}};view.reload(false,1);return {view,notes};
}

test('an early cancelled reload cannot play the next magazine sound, while a natural ending keeps its last notify',()=>{
  const early=reloadFixture();early.view.update(.39,{reloading:true});early.view.update(.02,{reloading:false});assert.deepEqual(early.notes,[]);assert.equal(early.view.mode,'idle');early.view.update(1);assert.deepEqual(early.notes,[]);
  const completed=reloadFixture();completed.view.update(.98,{reloading:true});assert.deepEqual(completed.notes,['mag-in']);completed.view.update(.03,{reloading:false});assert.deepEqual(completed.notes,['mag-in','finished']);assert.equal(completed.view.mode,'idle');
});
