import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TheaterMachines} from '../export/web/theater-machines.js';
function fixture(){
 const names=['teleporter_link_cable_off','teleporter_link_cable_on','zom_clock_hour_hand','zom_clock_minute_hand','zom_clock_second_hand','teleporter_indicator_lights'];
 const data={entities:names.map((targetname,id)=>({id,targetname,position:[0,0,0]}))},scene=new THREE.Scene(),entities=new Map();
 for(const e of data.entities){const g=new THREE.Group();entities.set(e.id,g);scene.add(g);}
 const shade=new THREE.MeshStandardMaterial({color:0xc0b090});shade.name='mc/mtl_glass_v2_off';
 const bulb=new THREE.Mesh(new THREE.BoxGeometry(2,4,2),shade);entities.get(5).add(bulb);
 return {scene,data,world:{entities},shade,bulb};
}
const same=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('native cable variants and lamp follow confirmed link/travel/cooldown states',()=>{
 const f=fixture(),m=new TheaterMachines({...f,clockTime:new Date(2000,0,1,3,15,0)});
 assert.equal(m.snapshot().cableOn,false);assert.equal(m.snapshot().cableOff,true);assert.equal(m.snapshot().indicator,'off');
 m.update({power:true});assert.equal(m.snapshot().indicator,'red');
 m.update({power:true,teleporter:'linking'});assert.equal(m.snapshot().cableOn,false);
 m.update({power:true,teleporter:'linked'});assert.equal(m.snapshot().indicator,'green');assert.equal(m.snapshot().cableOn,true);assert.equal(m.snapshot().cableOff,false);
 m.update({power:true,teleporter:'linked',teleportPending:10});assert.equal(m.snapshot().indicator,'red');
 m.update({power:true,teleporter:'cooldown',returnAt:30});assert.equal(m.snapshot().cableOn,true);
 m.update({power:true,teleporter:'cooldown',inReturnRoom:true});assert.equal(m.snapshot().cableOn,true);
 m.update({power:true,teleporter:'cooldown'});assert.equal(m.snapshot().cableOn,false);assert.equal(m.snapshot().indicator,'red');
 m.reset();assert.equal(m.snapshot().indicator,'off');m.dispose();
});
test('authored clock hands keep their pivots and pause; projection second hand sweeps 30 seconds',()=>{
 const f=fixture(),m=new TheaterMachines({...f,clockTime:new Date(2000,0,1,3,15,0)}),hand=f.world.entities.get(4),start=hand.position.clone();
 m.update({time:50,returnAt:80});same(hand.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI)),0);
 m.update({time:65,returnAt:80});same(hand.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI*1.5)),0);
 const before=m.snapshot();m.update({time:65,returnAt:80});assert.deepEqual(m.snapshot(),before);assert(hand.position.equals(start));
 m.update({time:80,returnAt:80});same(hand.quaternion.angleTo(new THREE.Quaternion()),0);
 m.update({time:81});same(hand.quaternion.angleTo(new THREE.Quaternion()),0);m.dispose();
});
test('restart does not allocate and disposal restores shared materials, geometry and authored visibility',()=>{
 const f=fixture(),original=f.bulb.material,m=new TheaterMachines(f),count=f.scene.children.length,g=f.bulb.geometry;
 assert.notEqual(f.bulb.material,original);assert.equal(original.emissiveIntensity,1);
 for(let i=0;i<4;i++){m.update({power:true,teleporter:'linked'});m.reset();assert.equal(f.scene.children.length,count);assert.equal(f.bulb.geometry,g);}
 m.dispose();assert.equal(f.bulb.material,original);assert.equal(f.scene.children.length,count-1);assert(f.world.entities.get(1).visible);
});
