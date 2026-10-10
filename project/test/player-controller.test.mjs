import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerController, buildCollisionOctree } from '../export/web/player-controller.js';
const close=(a,b,e=1e-7)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`);
function scene(...boxes){
  const group=new THREE.Group();
  for(const [size,position] of boxes){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size));mesh.position.set(...position);group.add(mesh);}
  return buildCollisionOctree(group);
}
const floor=()=>scene([[2000,20,2000],[0,-10,0]]);
function player(world=floor(),options={}){
  return new PlayerController(new THREE.PerspectiveCamera(),world,{spawn:new THREE.Vector3(0,.05,0),radius:14,height:70,eyeHeight:60,moveSpeed:190,sprintSpeed:285,crouchSpeed:95,gravity:800,jumpHeight:39,groundSnapSpeed:10,maxSubSteps:12,...options});
}
function run(p,seconds,input={},hz=120){for(let i=0;i<Math.round(seconds*hz);i++)p.update(1/hz,input);}

test('pause discards momentum and buffered actions but preserves the airborne vertical trajectory',()=>{
  for(const smoothCamera of [false,true]){
    const p=player(undefined,{smoothCamera});run(p,.3,{forward:1});assert(p.velocity.z<-180);
    p.setInput({forward:1,sprint:true,crouch:true,jump:true});p.update(.003);
    const feet=p.feetPosition.clone();p.clearInput({stopHorizontal:true});run(p,.3);
    close(p.feetPosition.x,feet.x);close(p.feetPosition.z,feet.z);assert(p.isGrounded);assert(!p.crouched);
    p.update(1/60,{jump:true});assert(p.velocity.y>0,'a fresh press after pause still jumps');
    const vertical=p.velocity.y;p.velocity.x=80;p.clearInput({stopHorizontal:true});close(p.velocity.y,vertical);close(p.velocity.x,0);
    p.update(1/120,{});assert(p.velocity.y<vertical&&p.velocity.y>0,'gravity resumes normally');
  }
});

test('crouched eye-coordinate respawn restores the requested eye and accepts a fresh jump',()=>{
  for(const smoothCamera of [false,true]){
    const p=player(undefined,{smoothCamera});run(p,.1,{crouch:true,jump:true});assert(p.crouched);
    p.reset(new THREE.Vector3(25,60.05,30),{eye:true});close(p.camera.position.y,60.05);close(p.feetPosition.y,.05);assert(!p.crouched);
    run(p,.05);p.update(1/60,{jump:true});assert(p.velocity.y>0);assert.equal(p.input.forward,0);
  }
});

test('opt-in camera smoothing leaves all fixed-step collision, sprint, crouch and jump motion unchanged',()=>{
  const world=scene([[2000,20,2000],[0,-10,0]],[[300,16,100],[0,8,-180]],[[200,200,20],[0,100,-350]]);
  const direct=player(world),smooth=player(world,{smoothCamera:true});
  for(let i=0;i<500;i++){
    const input={forward:i<420?1:0,sprint:i<100,crouch:i>=220&&i<300,jump:i===150};
    for(const p of [direct,smooth])p.update(1/120,input);
    assert.deepEqual(smooth.feetPosition.toArray(),direct.feetPosition.toArray());assert.deepEqual(smooth.velocity.toArray(),direct.velocity.toArray());
    close(direct.camera.position.y,direct.feetPosition.y+direct.eyeHeight);
    close(direct.camera.position.z,direct.feetPosition.z);
  }
});

test('render interpolation removes repeated high-refresh movement poses without predicting through walls',()=>{
  const world=scene([[2000,20,2000],[0,-10,0]],[[300,200,20],[0,100,-250]]);
  const direct=player(world),smooth=player(world,{smoothCamera:true});
  run(direct,.5,{forward:1});run(smooth,.5,{forward:1});
  const deltas=[[],[]];
  for(let i=0;i<72;i++)for(const [j,p]of [direct,smooth].entries()){
    const z=p.camera.position.z;p.update(1/144,{forward:1});deltas[j].push(Math.abs(p.camera.position.z-z));
    assert(p.camera.position.z>=p.feetPosition.z-1e-8,'view never extrapolates ahead into the wall');
    assert(p.camera.position.distanceTo(p.feetPosition.clone().add(new THREE.Vector3(0,60,0)))<2,'latency stays within one 120 Hz step');
  }
  assert(deltas[0].filter(v=>v<1e-8).length>=10);assert(deltas[1].every(v=>v>1),'smooth motion advances on every 144 Hz frame');
  run(smooth,1,{forward:1});assert(smooth.feetPosition.z>=-226.01);assert(smooth.camera.position.z>=-226.01);
});

test('a real 16-unit stair keeps capsule traversal while reducing the single-frame camera lift',()=>{
  const world=scene([[2000,20,2000],[0,-10,0]],[[300,16,300],[0,8,-250]]);
  const peaks=[];
  for(const smoothCamera of [false,true]){
    const p=player(world,{smoothCamera});let peak=0;
    for(let i=0;i<240;i++){const y=p.camera.position.y;p.update(1/120,{forward:i<160?1:0});peak=Math.max(peak,p.camera.position.y-y);}
    assert(Math.abs(p.feetPosition.y-16)<.1);close(p.camera.position.y,p.feetPosition.y+60,.1);peaks.push(peak);
  }
  assert(peaks[0]>3,`fixture must exercise a discrete stair, got ${peaks}`);assert(peaks[1]<peaks[0]*.65,`step smoothing must reduce the actual lift, got ${peaks}`);
});

test('stance easing stays below a real low ceiling and standing waits for clearance',()=>{
  const world=scene([[2000,20,2000],[0,-10,0]],[[160,20,130],[0,62,-180]]);
  const p=player(world,{smoothCamera:true});run(p,.1);const before=p.camera.position.y;p.update(1/60,{crouch:true});
  assert(p.camera.position.y<before&&p.camera.position.y>p.feetPosition.y+40,'open crouch eases instead of dropping twenty units');
  run(p,1.8,{forward:1,crouch:true});assert(p.feetPosition.z<-130);assert(p.camera.position.y<52);
  run(p,.5,{});assert(p.crouched,'release under the beam cannot stand');assert(p.camera.position.y<52);
  run(p,1.8,{forward:1});run(p,.5);assert(!p.crouched);close(p.camera.position.y,p.feetPosition.y+60,.1);
});

test('camera transitions remain frame-rate independent and reset never interpolates across a teleport',()=>{
  const values=[30,60,144].map(hz=>{
    const p=player(undefined,{smoothCamera:true});run(p,.5,{crouch:true},hz);run(p,.5,{},hz);const result={feet:p.feetPosition.toArray(),eye:p.camera.position.y};
    p.setPosition(new THREE.Vector3(100,200,300));assert.deepEqual(p.camera.position.toArray(),[100,260,300]);p.update(0);assert.deepEqual(p.camera.position.toArray(),[100,260,300]);return result;
  });
  for(const result of values.slice(1)){assert.deepEqual(result.feet,values[0].feet);close(result.eye,values[0].eye,.001);}
});

test('one real second advances identical gravity at 30, 60 and 144 Hz, including the exact final boundary',()=>{
  for(const smoothCamera of [false,true]){
    const drops=[30,60,144].map(hz=>{
      const p=player(null,{smoothCamera,spawn:new THREE.Vector3(0,1000,0)});run(p,1,{},hz);
      close(p.velocity.y,-800,1e-6);return p.feetPosition.y;
    });
    for(const y of drops.slice(1))close(y,drops[0]);
  }
});
