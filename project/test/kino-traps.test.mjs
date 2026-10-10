import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {KinoTraps,trapPlayerDamage} from '../export/web/kino-traps.js';
import {KinoSession} from '../export/web/kino-session.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
test('Authored trap corridor hurts entrants, not its remote switch; charge and restart are bounded',()=>{
  const scene=new THREE.Scene(),session={time:0,power:false,busy:false,points:3000,health:250,perks:new Set(['specialty_armorvest']),spend(n){if(this.points<n)return false;this.points-=n;return true;}},hits=[];
  const player={getFeetPosition:()=>new THREE.Vector3(1299,0,-1524)},world={lineClear:()=>true};
  const enemies={list:[{kind:'zombie',root:{position:new THREE.Vector3(1016,0,-1529)}},{kind:'zombie',root:{position:new THREE.Vector3(1299,0,-1524)}}],hurt:(...args)=>hits.push(args)};
  let damage=0;const traps=new KinoTraps({scene,data,session,world,enemies,player,audio:{playAt(){}},damage:n=>damage+=n});
  assert.equal(traps.traps.size,5);assert.equal(traps.activate('dressing_room_trap'),false);assert.equal(session.points,3000);
  session.power=true;assert(traps.activate('dressing_room_trap'));assert.equal(traps.activate('dressing_room_trap'),false);assert.equal(session.points,2000);
  traps.update(.1);assert.equal(hits.length,1);assert.equal(hits[0][0],enemies.list[0]);assert.equal(hits[0][5],false);assert.equal(damage,0);
  player.getFeetPosition=()=>new THREE.Vector3(1016,0,-1529);traps.update(.1);assert.equal(damage,16);
  traps.update(.01);assert.equal(damage,16,'attack cadence prevents repeated frame damage');
  world.lineClear=()=>false;session.time=.2;traps.update(.1);assert.equal(damage,16,'solid surfaces block contact from emitters');
  world.lineClear=()=>true;session.perks.clear();session.health=100;traps.update(.1);assert.equal(damage,216,'unprotected contact is lethal');
  session.time=41;traps.update(.1);assert.equal(traps.activate('dressing_room_trap'),false);assert(traps.snapshot().every(t=>!t.active));
  const geometry=[...traps.traps.values()].map(t=>t.mesh.geometry);for(let i=0;i<5;i++)traps.reset();assert.equal(scene.children.length,5);assert.deepEqual([...traps.traps.values()].map(t=>t.mesh.geometry),geometry);assert(traps.snapshot().every(t=>t.cooldown===0));
});

test('Classic electric trap preserves the documented 101/100 health boundary while fire remains 25 damage',()=>{
  assert.equal(trapPlayerDamage('electric',250,true),16);
  assert.equal(trapPlayerDamage('electric',101,true),16);
  assert.equal(trapPlayerDamage('electric',100,true),200);
  assert.equal(trapPlayerDamage('electric',99,true),199);
  assert.equal(trapPlayerDamage('electric',250,false),350);
  assert.equal(trapPlayerDamage('fire',101,true),25);
  assert.equal(trapPlayerDamage('fire',100,true),25);
  assert.equal(trapPlayerDamage('fire',100,false),200);
});

test('trap contact respects invulnerability and Quick Revive; reset clears its damage cadence',()=>{
  const session=new KinoSession(data,()=>.5);session.power=true;session.points=1000;
  session.perks.add('specialty_armorvest');session.perks.add('specialty_quickrevive');session.health=101;
  const traps=new KinoTraps({scene:new THREE.Scene(),data,session,world:{lineClear:()=>true},enemies:{list:[]},player:{getFeetPosition:()=>new THREE.Vector3(1016,0,-1529)},audio:{playAt(){}},damage:n=>session.damage(n)});
  assert(traps.activate('dressing_room_trap'));session.effects.invulnerable=1;traps.update(.01);assert.equal(session.health,101);
  session.effects.invulnerable=0;session.time=.11;traps.update(.01);assert.equal(session.health,85);assert.notEqual(session.phase,'reviving');
  session.time=.22;traps.update(.01);assert.equal(session.health,0);assert.equal(session.phase,'reviving');
  session.update(4.01);assert.equal(session.health,100);assert(session.effects.invulnerable>session.time);traps.update(.01);assert.equal(session.health,100);
  traps.reset();session.reset();assert.equal(traps.nextDamage,0);assert(traps.snapshot().every(t=>!t.active&&!t.visible&&t.cooldown===0));assert.equal(session.health,100);
});
