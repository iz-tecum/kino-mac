import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameAudio } from '../export/web/audio.js';

class Param {
  constructor(){this.value=0;}
  setValueAtTime(value){this.value=value;}
  exponentialRampToValueAtTime(value){this.endValue=value;}
}
class Node {
  constructor(type){this.type=type;this.gain=new Param();this.frequency=new Param();this.connections=[];this.disconnects=0;this.started=false;this.stopped=false;}
  connect(node){this.connections.push(node);}
  disconnect(){this.connections=[];this.disconnects++;}
  start(){this.started=true;}
  stop(when){this.stopped=true;if(when===undefined)this.end();}
  end(){this.onended?.();}
}
class Context {
  constructor(){this.state='suspended';this.destination={};this.nodes=[];this.currentTime=0;this.sampleRate=8000;}
  node(type){const node=new Node(type);this.nodes.push(node);return node;}
  createGain(){return this.node('gain');}
  createBufferSource(){return this.node('source');}
  createOscillator(){return this.node('oscillator');}
  createBiquadFilter(){return this.node('filter');}
  createBuffer(channels,length){return {length,numberOfChannels:channels,getChannelData:()=>new Float32Array(length)};}
  async resume(){this.state='running';}
  async suspend(){this.state='suspended';}
}
const decoded={length:800,numberOfChannels:1};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  Object.defineProperty(globalThis,'AudioContext',{configurable:true,writable:true,value:Context});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'AudioContext',previous);else delete globalThis.AudioContext;});
  const audio=new GameAudio();audio.preload=false;audio.buffer=async()=>decoded;audio.start();await settle();
  return audio;
}

test('default mixer retains original master, ambient, music and individual cue volumes',async t=>{
  const audio=await setup(t);
  assert.equal(audio.master.gain.value,.42);
  for(const node of Object.values(audio.groups))assert.equal(node.gain.value,1);
  assert.equal(audio.music.connections[0].gain.value,.18);
  const shot=await audio.native('resident/wpn/pistol/shot',.75);
  assert.equal(shot.connections[0].gain.value,.75);assert.equal(shot.connections[0].connections[0],audio.groups.effects);
  await audio.playMusic('115');assert.equal(audio.music.connections[0].gain.value,.65);
  assert.equal(audio.music.connections[0].connections[0],audio.groups.music);
});

test('mix changes affect active category buses without rewriting native cue gains',async t=>{
  const audio=await setup(t),announcement=await audio.native('dog_announce',.8);
  const sound=await audio.native('full_ammo',.7),effect=await audio.native('board',.4);
  assert.equal(announcement.connections[0].connections[0],audio.groups.dialogue);
  assert.equal(sound.connections[0].connections[0],audio.groups.dialogue);
  assert.equal(effect.connections[0].connections[0],audio.groups.effects);
  audio.setMix({master:50,effects:20,music:30,ambience:40,dialogue:0});
  assert.equal(audio.master.gain.value,.21);assert.equal(audio.groups.effects.gain.value,.2);
  assert.equal(audio.groups.music.gain.value,.3);assert.equal(audio.groups.ambience.gain.value,.4);
  assert.equal(audio.groups.dialogue.gain.value,0);assert.equal(announcement.connections[0].gain.value,.8);
  audio.enabled=false;assert.equal(audio.master.gain.value,0);audio.enabled=true;assert.equal(audio.master.gain.value,.21);
  audio.setMix({effects:200,music:-1,dialogue:NaN,master:Infinity});
  assert.deepEqual(audio.snapshot().mix,{master:50,effects:100,music:0,ambience:40,dialogue:0});
  const snapshot=audio.snapshot();snapshot.mix.master=0;assert.equal(audio.snapshot().mix.master,50);
});

test('native and procedural sounds share a 48-voice ceiling while ambience continues',async t=>{
  const audio=await setup(t),ambient=audio.music;
  const first=await audio.native('board');
  for(let i=0;i<60;i++)if(i%2)audio.play('hit');else await audio.native('board');
  assert.equal(audio.snapshot().voices,48);assert.equal(audio.snapshot().musicVoices,1);
  assert(first.stopped);assert.equal(first.disconnects,1);assert.equal(ambient.stopped,false);
  assert.equal(audio.snapshot().voicesByChannel.effects,48);
  assert.equal(audio.voices.size,48);
  await audio.reset();assert.equal(audio.snapshot().voices,0);assert.equal(audio.snapshot().musicVoices,0);
  assert.equal(ambient.disconnects,1);
});

test('procedural noise and oscillator nodes disconnect on end and on reset',async t=>{
  const audio=await setup(t);
  let offset=audio.ctx.nodes.length;audio.play('shot');const noise=audio.ctx.nodes.slice(offset);
  assert.equal(noise.length,3);noise.find(n=>n.type==='source').end();
  assert(noise.every(n=>n.disconnects===1));assert.equal(audio.snapshot().voices,0);
  offset=audio.ctx.nodes.length;audio.play('buy');const tone=audio.ctx.nodes.slice(offset);
  assert.equal(tone.length,2);await audio.reset();assert(tone.every(n=>n.disconnects===1));
});

test('reset invalidates pending sounds and music before any delayed source can start',async t=>{
  const audio=await setup(t),waiting=[];
  audio.buffer=key=>new Promise(resolve=>waiting.push({key,resolve}));
  const short=audio.native('board'),music=audio.playMusic('115');audio.fireSale(true);
  assert.equal(audio.snapshot().pendingVoices,3);
  await audio.reset();assert.equal(audio.snapshot().pendingVoices,0);
  const count=audio.ctx.nodes.filter(n=>n.started).length;
  for(const request of waiting)request.resolve(decoded);
  const cancelled=await short;await music;await settle();
  assert.doesNotThrow(()=>cancelled.stop());
  assert.equal(audio.ctx.nodes.filter(n=>n.started).length,count);
  assert.equal(audio.music,null);assert.equal(audio.saleMusic,null);assert.equal(audio.saleOn,false);
  assert.equal(audio.snapshot().state,'suspended');assert.equal(audio.snapshot().voices,0);
  audio.buffer=async()=>decoded;audio.start();await settle();
  assert.equal(audio.snapshot().state,'running');assert.equal(audio.snapshot().musicVoices,1);
  assert.deepEqual(audio.snapshot().played,['ambience']);
});

test('pause suspends existing voices and resume preserves them without duplicate ambience',async t=>{
  const audio=await setup(t),ambient=audio.music,source=await audio.native('board');
  await audio.pause();assert.equal(audio.snapshot().state,'suspended');
  const count=audio.snapshot().voices;audio.play('hit');assert.equal(audio.snapshot().voices,count);
  audio.start();await settle();assert.equal(audio.snapshot().state,'running');
  assert.equal(audio.music,ambient);assert.equal(source.stopped,false);assert.equal(audio.snapshot().musicVoices,1);
});

test('fire-sale music has its own music-bus voice and is cleaned without stopping ambience',async t=>{
  const audio=await setup(t),ambient=audio.music;
  audio.fireSale(true);await settle();const sale=audio.saleMusic;
  assert.equal(sale.connections[0].gain.value,.35);assert.equal(sale.connections[0].connections[0],audio.groups.music);
  assert.equal(audio.snapshot().musicVoices,2);audio.fireSale(false);
  assert.equal(sale.disconnects,1);assert.equal(audio.music,ambient);assert.equal(audio.snapshot().musicVoices,1);
});
