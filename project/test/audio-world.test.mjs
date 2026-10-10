import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { GameAudio } from '../export/web/audio.js';
import { surfaceFromMaterial } from '../export/web/audio-surfaces.js';
import { KinoFeatures } from '../export/web/kino-features.js';
import * as THREE from 'three';

const manifest=JSON.parse(fs.readFileSync(new URL('../export/web/audio/manifest.json',import.meta.url)));
class Param{constructor(){this.value=0;}setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.endValue=v;}}
class AudioNode{
  constructor(type){this.type=type;this.connections=[];this.disconnects=0;for(const key of ['gain','frequency','positionX','positionY','positionZ'])this[key]=new Param();}
  connect(n){this.connections.push(n);}disconnect(){this.connections=[];this.disconnects++;}start(){this.started=true;}stop(t){this.stopped=true;if(t===undefined)this.onended?.();}
}
class Context{
  constructor(){this.state='suspended';this.currentTime=0;this.sampleRate=8000;this.destination={};this.nodes=[];this.listener={};for(const prefix of ['position','forward','up'])for(const axis of ['X','Y','Z'])this.listener[prefix+axis]=new Param();}
  node(type){const n=new AudioNode(type);this.nodes.push(n);return n;}
  createGain(){return this.node('gain');}createBufferSource(){return this.node('source');}createPanner(){return this.node('panner');}createBiquadFilter(){return this.node('filter');}createOscillator(){return this.node('oscillator');}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return{length,numberOfChannels:channels,getChannelData:channel=>data[channel]};}
  async resume(){this.state='running';}async suspend(){this.state='suspended';}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function installContext(t){const previous=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');Object.defineProperty(globalThis,'AudioContext',{configurable:true,writable:true,value:Context});t.after(()=>{if(previous)Object.defineProperty(globalThis,'AudioContext',previous);else delete globalThis.AudioContext;});}
async function setup(t){installContext(t);const a=new GameAudio();a.manifest=manifest;a.preload=false;a.buffer=async()=>({length:800,numberOfChannels:1});a.start();await settle();return a;}

test('recovered movement and impact assets are real Ogg files with unchanged encoded hashes and source provenance',()=>{
  const shared=Object.entries(manifest).filter(([k])=>k.startsWith('shared/'));assert.equal(shared.length,87);
  for(const [key,item]of shared){const data=fs.readFileSync(new URL('../export/web/'+item.url,import.meta.url));assert.equal(data.subarray(0,4).toString(),'OggS',key);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.encodedSha256,key);assert.match(item.source,/zone\/Common\/(?:common_zombie|zombie_moon)\.ff:sound\//);assert(item.recoveredFrom.startsWith('moon/audio/'));}
});
test('surface classification uses material names and a conservative concrete default',()=>{
  for(const [name,surface]of [['theater_carpet_red','carpet'],['wood_floor_plank','wood'],['metal_grate','metal'],['dirt_alley','dirt'],['marble_tile','concrete'],['unknown','concrete']])assert.equal(surfaceFromMaterial(name),surface);
});
test('native zombie impacts are positional effects and preserve the existing creature voice bank',async t=>{
  const a=await setup(t);a.impact('zombie-head',[80,60,-100],.35);a.impact('zombie-electric',[-80,20,-100],.3);await settle();
  const e=a.snapshot().recentEvents.slice(-2);assert(e.every(x=>x.native&&x.channel==='effects'&&x.position));assert.match(e[0].key,/shared\/fly\/gibs\/zombie\/head\//);assert.match(e[1].key,/shared\/fly\/gibs\/zombie\/elec\//);assert.equal(a.snapshot().enemy.active,0);
});
test('layered PAP fire remains within the shared voice ceiling and reset cancels all queued layers',async t=>{
  const a=await setup(t),data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url))),def={...data.weapons.mp40_zm,...data.weapons.mp40_zm.upgrade};
  for(let i=0;i<24;i++)a.weapon('shot',def);await settle();assert.equal(a.snapshot().voices,48);assert(a.snapshot().played.some(k=>k==='shared/wpn/pap/pap_shot_st'));
  const resolves=[];a.buffer=()=>new Promise(r=>resolves.push(r));a.weapon('shot',def);assert.equal(a.snapshot().pendingVoices,4);await a.reset();for(const resolve of resolves)resolve({length:800,numberOfChannels:1});await settle();assert.equal(a.snapshot().voices,0);assert.equal(a.snapshot().pendingVoices,0);
});
test('movement selects native surface and gait variants without consecutive repetition',async t=>{
  const a=await setup(t),first=a.movement('step',{surface:'wood'}),second=a.movement('step',{surface:'wood'});assert.notEqual(first,second);assert.match(first,/\/walk\/wood\//);
  assert.match(a.movement('step',{surface:'wood',sprint:true}),/\/sprint\/wood\//);
  assert.match(a.movement('step',{surface:'carpet'}),/\/run\/carpet\//);
  assert.match(a.movement('land',{surface:'metal'}),/\/land\/metal\//);
  assert.match(a.movement('step',{surface:'unmapped'}),/\/walk\/concrete\//);
  await settle();assert(a.snapshot().recentEvents.slice(-6).every(e=>e.native&&e.channel==='effects'&&e.position===null));
});
test('new world APIs leave existing generic movement behavior unchanged for other maps',async t=>{
  const a=await setup(t);a.play('step');assert.equal(a.snapshot().recentEvents.at(-1).key,'step');assert.equal(a.snapshot().recentEvents.at(-1).native,false);
  const key=a.movement('land',{surface:'wood'});await settle();assert.equal(a.snapshot().recentEvents.at(-1).key,key);assert.equal(a.snapshot().recentEvents.at(-1).native,true);
});
test('native impacts use positional effects buses and preserve the emitter position through async decoding',async t=>{
  const a=await setup(t),p={x:300,y:40,z:-50};a.setMix({effects:25,music:70});
  const key=a.impact('raygun',p,.6);p.x=900;await settle();const voice=[...a.voices].at(-1),gain=voice.source.connections[0],panner=gain.connections[0];
  assert.equal(key,'shared/wpn/energy/raygun/projectile/impact/wpn_ray_exp');assert.equal(panner.type,'panner');assert.equal(panner.positionX.value,300);assert.equal(panner.panningModel,'HRTF');assert.equal(panner.distanceModel,'linear');assert.equal(panner.maxDistance,1400);assert.equal(panner.connections[0],a.groups.effects);assert.equal(a.groups.effects.gain.value,.25);
  assert.deepEqual(a.snapshot().recentEvents.at(-1).position,[300,40,-50]);assert.equal(a.snapshot().spatialVoices,1);
  voice.source.onended();assert.equal(panner.disconnects,1);assert.equal(a.snapshot().spatialVoices,0);
});
test('listener position and orientation can be supplied before audio starts',async t=>{
  installContext(t);const a=new GameAudio();a.preload=false;a.buffer=async()=>({length:80,numberOfChannels:1});
  assert(a.setListener([10,60,30],[1,0,0]));a.start();await settle();assert.equal(a.ctx.listener.positionY.value,60);assert.equal(a.ctx.listener.forwardX.value,1);assert.equal(a.ctx.listener.upY.value,1);
  assert.equal(a.setListener([NaN,0,0]),false);assert.equal(a.ctx.listener.positionY.value,60);
});
test('synthesized bullet impacts are explicitly identified and share spatial voice limits and cleanup',async t=>{
  const a=await setup(t),ambient=a.music;assert.equal(a.impact('bullet',[20,30,40]),null);
  const first=[...a.voices][0].source;for(let i=0;i<60;i++)a.impact('bullet',[i,0,0]);
  assert(first.stopped);assert.equal(a.snapshot().voices,48);assert.equal(a.snapshot().spatialVoices,48);assert.equal(a.snapshot().musicVoices,1);assert.equal(a.snapshot().recentEvents.at(-1).native,false);
  await a.reset();assert.equal(a.snapshot().voices,0);assert.equal(a.snapshot().spatialVoices,0);assert.equal(a.snapshot().recentEvents.length,0);assert(ambient.stopped);assert(a.ctx.nodes.filter(n=>n.type==='panner').every(n=>n.disconnects===1));
});
test('a reset cancels pending positional native audio before any panner or source is created',async t=>{
  const a=await setup(t);let resolve;a.buffer=()=>new Promise(r=>resolve=r);const before=a.ctx.nodes.length;
  a.impact('grenade',[0,0,-300]);assert.equal(a.snapshot().pendingVoices,1);await a.reset();resolve({length:80,numberOfChannels:1});await settle();
  assert.equal(a.ctx.nodes.length,before);assert.equal(a.snapshot().pendingVoices,0);assert.equal(a.snapshot().spatialVoices,0);
});
test('a Monkey Bomb song is emitted once from the lure and stopped even when removed during decode',async t=>{
  const audio=await setup(t),feature=Object.create(KinoFeatures.prototype);feature.audio=audio;
  const p={mesh:new THREE.Group()},list=[p];p.mesh.position.set(100,20,-200);
  feature.startMonkeyAudio(p);feature.startMonkeyAudio(p);await settle();
  assert.equal(audio.snapshot().spatialVoices,1);assert.match(audio.snapshot().recentEvents.at(-1).key,/shared\/wpn\/monkey\/monkey_song_/);
  feature.remove(p,list);assert.equal(audio.snapshot().spatialVoices,0);assert.equal(list.length,0);
  let resolve;audio.buffer=()=>new Promise(r=>resolve=r);const delayed={mesh:new THREE.Group()},pending=[delayed],nodeCount=audio.ctx.nodes.length;feature.startMonkeyAudio(delayed);feature.remove(delayed,pending);
  resolve({length:80,numberOfChannels:1});await settle();assert.equal(audio.ctx.nodes.length,nodeCount);assert.equal(audio.snapshot().spatialVoices,0);assert.equal(audio.snapshot().voices,0);
});
test('audio event catalog names valid native cues and explicitly blocks unprovided radio recordings',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../AUDIO-EVENT-CATALOG.json',import.meta.url)));
  assert.equal(catalog.nativeAssetCount,Object.values(manifest).filter(m=>m.native!==false).length);
  assert.equal(catalog.communityAssetCount,Object.values(manifest).filter(m=>m.native===false).length);
  assert.equal(catalog.decodedAssetCount,Object.keys(manifest).length);
  for(const event of catalog.events){assert(event.source);assert(event.timing);assert(event.channel);assert(event.concurrency.globalVoiceLimit>0);for(const key of event.cueKeys)assert(manifest[key],event.event+': '+key);}
  const radios=catalog.events.find(e=>e.event==='kino_radio_recordings');assert.equal(radios.classification,'missing');assert.equal(radios.cueKeys.length,0);assert(radios.notes.join(' ').includes('vox_zmb_egg_00'));
});
test('trap loops have bounded nonzero PCM, stay on the effects bus, and survive mute/pause without duplication',async t=>{
  const a=await setup(t),electric=a.trapLoop('electric',[10,20,30]),fire=a.trapLoop('fire',[-10,20,30]);
  assert.equal(a.snapshot().voices,2);assert.equal(a.snapshot().spatialVoices,2);assert.equal(a.snapshot().musicVoices,1);assert.equal(a.synthBuffers.size,2);
  assert.equal(a.snapshot().syntheticBufferBytes,2*2*a.ctx.sampleRate*4);
  for(const buffer of a.synthBuffers.values()){const pcm=buffer.getChannelData(0);assert(pcm.some(n=>n!==0));assert(pcm.every(n=>Number.isFinite(n)&&Math.abs(n)<=1));assert.equal(Math.abs(pcm[0]),0);assert.equal(Math.abs(pcm.at(-1)),0);}
  for(const voice of a.voices){assert.equal(voice.channel,'effects');assert(voice.source.loop);assert.equal(voice.source.connections[0].connections[0].connections[0].connections[0],a.groups.effects);}
  assert(a.snapshot().recentEvents.slice(-2).every(e=>e.native===false&&e.key.startsWith('trap/')));
  a.enabled=false;assert.equal(a.master.gain.value,0);await a.pause();a.start();await settle();a.enabled=true;assert.equal(a.snapshot().voices,2);assert.equal(a.snapshot().musicVoices,1);assert.equal(a.master.gain.value,.42);
  electric.stop();electric.stop();assert.equal(a.snapshot().voices,1);fire.disconnect();assert.equal(a.snapshot().voices,0);
});
test('trap sounds obey the shared voice ceiling and reset stops every active loop and node',async t=>{
  const a=await setup(t);a.maxVoices=4;const handles=[];for(let i=0;i<7;i++)handles.push(a.trapLoop(i%2?'fire':'electric',[i,0,0]));
  assert.equal(a.snapshot().voices,4);assert.equal(a.synthBuffers.size,2);assert(a.ctx.nodes.filter(n=>n.type==='source').some(n=>n.stopped));
  await a.reset();assert.equal(a.snapshot().voices,0);assert.equal(a.snapshot().spatialVoices,0);assert(a.ctx.nodes.filter(n=>n.type==='panner').every(n=>n.disconnects===1));
  for(const handle of handles)assert.doesNotThrow(()=>handle.stop());assert.equal(a.snapshot().voices,0);
  const count=a.ctx.nodes.length;a.trapLoop('fire',[0,0,0]);assert.equal(a.ctx.nodes.length,count,'reset does not accept a new trap before the run starts');
});
