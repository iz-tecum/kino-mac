import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MoonCombat} from '../export/web/moon-combat.js';
import {MoonEnemies} from '../export/web/moon-enemies.js';

const setup=()=>{const calls=[],combat=Object.create(MoonCombat.prototype);combat.audio={play:(...args)=>calls.push(args)};combat.camera={position:new THREE.Vector3()};return{combat,calls};};

test('shared enemy reset with a null position is safe for Moon area transitions',()=>{
 const {combat,calls}=setup(),enemies=new MoonEnemies(new THREE.Scene(),{}, {},{time:0},{sound:(event,p)=>combat.enemySound(event,p)});
 assert.doesNotThrow(()=>enemies.reset());assert.equal(calls.length,0);assert.equal(enemies.list.length,0);assert.equal(enemies.dead.length,0);assert.equal(enemies.spawnDelay,2);
});
test('Moon never renders shared lifecycle or unsupported actor events as generic oscillator tones',()=>{
 const {combat,calls}=setup(),p=new THREE.Vector3(300,0,0);
 for(const event of ['reset','update','remove','spawn','step','attack','death','teardown']){combat.enemySound(event,p);combat.enemySound(event,null);}
 for(const p of [null,undefined,[],new THREE.Vector3(NaN,0,0)])combat.enemySound('ambient',p);
 assert.deepEqual(calls,[]);
});
test('Moon preserves distance-scaled legacy growls and board cues for matching state events',()=>{
 const {combat,calls}=setup(),p=new THREE.Vector3(300,0,400);
 for(const event of ['growl','ambient','sprint','behind','board','barrier'])combat.enemySound(event,p);
 assert.deepEqual(calls,[['growl',.5],['growl',.5],['growl',.5],['growl',.5],['board',.5],['board',.5]]);
 combat.enemySound('ambient',new THREE.Vector3(2000,0,0));assert.deepEqual(calls.at(-1),['growl',0]);
});
