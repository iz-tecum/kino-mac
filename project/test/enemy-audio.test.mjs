import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GameAudio} from '../export/web/audio.js';
import {EnemyAudio,enemyCueKeys,enemyFootstepKeys,enemyVoiceProfile} from '../export/web/enemy-audio.js';
import {Enemies} from '../export/web/enemies.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../export/web/audio/manifest.json',import.meta.url)));
const catalog=JSON.parse(fs.readFileSync(new URL('../export/web/audio/enemies/catalog.json',import.meta.url)));
const settle=()=>new Promise(r=>setImmediate(r));
class Param{constructor(){this.value=0;}setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}setTargetAtTime(v,time,constant){this.value=v;this.target={value:v,time,constant};}linearRampToValueAtTime(v,time){this.ramps??=[];this.ramps.push({value:v,time});}cancelAndHoldAtTime(time){this.held=time;}}
class AudioNode{constructor(type){this.type=type;this.connections=[];for(const k of ['gain','frequency','positionX','positionY','positionZ','playbackRate'])this[k]=new Param();}connect(n){this.connections.push(n);}disconnect(){this.connections=[];}start(){this.started=true;}stop(t){this.stopped=true;if(t===undefined)this.onended?.();}}
class Context{constructor(){this.state='running';this.currentTime=10;this.sampleRate=8000;this.destination={};this.nodes=[];this.listener={};}node(t){const n=new AudioNode(t);this.nodes.push(n);return n;}createGain(){return this.node('gain');}createBufferSource(){return this.node('source');}createPanner(){return this.node('panner');}createBiquadFilter(){return this.node('filter');}createBuffer(c,l){const data=Array.from({length:c},()=>new Float32Array(l));return{length:l,numberOfChannels:c,getChannelData:i=>data[i]};}async suspend(){this.state='suspended';}async resume(){this.state='running';}}
function setup(){const a=new GameAudio();a.manifest=manifest;a.ctx=new Context();a.master=a.ctx.createGain();a.groups={effects:a.ctx.createGain()};a.buffer=async()=>({length:8000,numberOfChannels:1});a.enemyAudio=new EnemyAudio(a,{random:()=>0});a.setListener([0,48,0]);return a;}
const meta=(id,kind='zombie')=>({id,kind});

test('47 licensed community recordings retain exact pinned Git blob and SHA256 hashes',()=>{
 assert.equal(catalog.count,47);assert.equal(catalog.assets.length,47);assert.equal(catalog.sourceCommit,'70a14104914f2fc65b99b3c58b1f92c2356ecf76');let total=0;
 for(const item of catalog.assets){const bytes=fs.readFileSync(new URL('../export/web/'+item.url,import.meta.url));total+=bytes.length;assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WAVE');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.encodedSha256);assert.equal(crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'),item.sourceGitBlob);const {key,...metadata}=item;assert.deepEqual(manifest[key],metadata);assert.equal(item.native,false);assert.match(item.license,/by-sa\/4\.0/);assert.match(item.source,/\/70a14104914f2fc65b99b3c58b1f92c2356ecf76\//);}
 assert.equal(total,catalog.encodedBytes);assert.match(fs.readFileSync(new URL('../export/web/audio/enemies/ATTRIBUTION.txt',import.meta.url),'utf8'),/NZ:P/);
});
test('enemy state families are distinct, native dog growl retained and Nova approximation explicit',()=>{
 assert.equal(enemyCueKeys(manifest,'zombie','attack').length,8);assert.equal(enemyCueKeys(manifest,'zombie','death').length,8);assert.equal(enemyCueKeys(manifest,'zombie','sprint').length,10);assert.equal(enemyCueKeys(manifest,'nova','ambient').length,5);assert.deepEqual(enemyCueKeys(manifest,'dog','ambient'),['dog']);assert.deepEqual(enemyCueKeys(manifest,'dog','attack'),['enemy/nzp/hound/a0']);assert.equal(enemyCueKeys(manifest,'zombie','unknown').length,0);assert.match(catalog.fidelity,/approximate/);
});
test('actual playback uses effects HRTF and moving emitter height, with separate Nova rate',async()=>{
 const a=setup();a.enemy('attack',[100,10,-100],meta(1,'nova'));await settle();const voice=[...a.voices][0],p=voice.spatialNodes[0];assert.equal(p.panningModel,'HRTF');assert.equal(p.connections[0],a.groups.effects);assert.equal(voice.source.playbackRate.value,1.25*enemyVoiceProfile(1,'nova',0).pitch);assert.equal(p.positionY.value,30);
 a.enemy('update',[-200,20,-40],meta(1,'nova'));assert.deepEqual([p.positionX.value,p.positionY.value,p.positionZ.value],[-200,40,-40]);assert.equal(a.snapshot().recentEvents[0].native,false);assert.equal(a.snapshot().recentEvents[0].sourceType,'community-recording');a.enemy('remove',null,meta(1));assert.equal(a.voices.size,0);
 a.enemy('barrier',[100,10,-100],meta(2));await settle();a.enemy('update',[200,20,-100],meta(2));assert.equal([...a.voices][0].spatialNodes[0].positionY.value,45);
});
test('higher priority attack/death cancels actor vocal and pending decode cannot resurrect',async()=>{
 const a=setup(),resolvers=[];a.buffer=()=>new Promise(r=>resolvers.push(r));
 assert(a.enemy('ambient',[100,0,-100],meta(1)));assert.equal(a.enemy('ambient',[100,0,-100],meta(1)),false);assert(a.enemy('attack',[100,0,-100],meta(1)));assert(a.enemy('death',[100,0,-100],meta(1)));assert.equal(a.enemy('attack',[100,0,-100],meta(1)),false);
 for(const r of resolvers)r({length:8000,numberOfChannels:1});await settle();assert.equal(a.voices.size,1);assert.equal(a.snapshot().recentEvents.length,1);assert.equal(a.snapshot().recentEvents[0].enemyEvent,'death');assert.equal(a.enemyAudio.snapshot().active,1);
 const source=[...a.voices][0].source;a.enemy('remove',null,meta(1));assert(source.stopped);assert.equal(a.voices.size,0);assert.equal(a.enemyAudio.snapshot().active,0);
});
test('removal and reset abort queued vocals before allocating any source or spatial node',async()=>{
 const a=setup(),resolvers=[];a.buffer=()=>new Promise(r=>resolvers.push(r));const baseline=a.ctx.nodes.length;
 a.enemy('spawn',[0,0,-100],meta(1));a.enemy('remove',null,meta(1));a.enemy('spawn',[0,0,-100],meta(2));await a.reset();for(const r of resolvers)r({length:8000,numberOfChannels:1});await settle();assert.equal(a.ctx.nodes.length,baseline);assert.equal(a.voices.size,0);assert.equal(a.pendingVoices.size,0);assert.equal(a.enemyAudio.snapshot().active,0);
});
test('24 simultaneous actors stay within ten creature voices and retain eight general slots during decode',async()=>{
 const a=setup();for(let id=1;id<=24;id++)a.enemy('spawn',[id,0,-100],meta(id));await settle();assert.equal(a.voices.size,10);assert.equal(a.enemyAudio.snapshot().active,10);assert.equal(a.enemyAudio.snapshot().suppressed,14);
 a.enemyAudio.reset();const general=[];for(let i=0;i<38;i++){a.playAt('impact',[i,0,-100]);general.push([...a.voices].at(-1).source);}
 const resolvers=[];a.buffer=()=>new Promise(r=>resolvers.push(r));for(let id=1;id<=10;id++)a.enemy('spawn',[id,0,-100],meta(id));assert.equal(a.enemyAudio.snapshot().active,2);
 // A weapon/footstep can use a reserved slot while the enemy requests decode.
 a.playAt('impact',[0,0,0]);for(const r of resolvers)r({length:8000,numberOfChannels:1});await settle();assert.equal(a.voices.size,40);assert.equal(a.enemyAudio.snapshot().active,1);assert(general.every(source=>a.sourceVoices.has(source)));assert.equal(a.maxVoices-a.voices.size,8);
});
test('event cooldown, nearby behind throttle, no repeated variant, and distant/muted guards bound chatter',async()=>{
 const a=setup();const first=a.enemy('ambient',[0,0,100],meta(1));await settle();assert.equal(a.snapshot().recentEvents.at(-1).enemyEvent,'behind');a.enemy('ambient',[0,0,100],meta(2));await settle();assert.equal(a.snapshot().recentEvents.at(-1).enemyEvent,'ambient');
 a.enemy('remove',null,meta(2));const previous=a.snapshot().recentEvents.at(-1).key;a.enemy('ambient',[0,0,100],meta(3));await settle();assert.notEqual(a.snapshot().recentEvents.at(-1).key,previous);assert(first);
 assert.equal(a.enemy('attack',[0,0,2000],meta(4)),false);assert.equal(a.enemy('attack',[0,0],meta(4)),false);a.paused=true;assert.equal(a.enemy('attack',[0,0,-100],meta(4)),false);a.paused=false;a.mix.effects=0;assert.equal(a.enemy('attack',[0,0,-100],meta(4)),false);a.mix.effects=100;a.enabled=false;assert.equal(a.enemy('attack',[0,0,-100],meta(4)),false);
});
function realEnemies(){const events=[],session={round:1,dogRounds:1,phase:'fighting',time:0,spawned:0,total:99,kills:0,killed:0,effects:{},random:()=>.5,scoreHit(kill){if(kill){this.kills++;this.killed++;}}};const world={lineClear:()=>true,path:(a,b)=>[a.clone(),b.clone()],closest:p=>p.clone(),setBoards:(b,n)=>b.count=n};const e=new Enemies(new THREE.Scene(),world,{rules:{}},session,{damage:()=>{},sound:(event,p,m)=>events.push({event,position:p?.toArray(),...m})});e.templates=[new THREE.Group()];e.heads=[];e.dog=new THREE.Group();e.quad=new THREE.Group();e.autoSpawn=false;e.autoRounds=false;return{e,events,session};}
test('actual enemy attack transition, death, corpse expiry and reset emit actor-specific events once',()=>{
 const {e,events,session}=realEnemies(),p=new THREE.Vector3();for(const kind of ['zombie','dog','nova']){const z=e.spawn(new THREE.Vector3(0,0,-40),null,kind);assert.equal(events.at(-1).event,'spawn');e.update(.01,p);assert.equal(events.filter(x=>x.id===z.id&&x.event==='attack').length,1);e.update(.1,p);assert.equal(events.filter(x=>x.id===z.id&&x.event==='attack').length,1);e.hurt(z,99999);e.hurt(z,99999);assert.equal(events.filter(x=>x.id===z.id&&x.event==='death').length,1);assert.equal(events.find(x=>x.id===z.id&&x.event==='death').kind,kind);}assert.equal(session.kills,3);e.update(5,p);assert.equal(events.filter(x=>x.event==='remove').length,3);e.reset();assert.equal(events.at(-1).event,'reset');
});
test('real board tearing, ambient/sprint transitions, nuke and despawn carry positions and IDs',()=>{
 const {e,events}=realEnemies(),p=new THREE.Vector3(),barrier={outside:new THREE.Vector3(100,0,0),inside:new THREE.Vector3(70,0,0),count:6};const z=e.spawn(null,barrier);e.update(1.2,p);assert.equal(barrier.count,5);assert.equal(events.filter(x=>x.event==='barrier').length,1);assert.equal(events.filter(x=>x.event==='teardown').length,1);z.growl=0;e.update(.1,p);assert.equal(events.at(-2).event,'update');assert.equal(events.at(-1).event,'ambient');z.speed=180;z.growl=0;e.update(.1,p);assert.equal(events.at(-1).event,'sprint');e.nuke(()=>{});assert.equal(events.at(-1).event,'death');assert.equal(events.at(-1).cause,'nuke');const other=e.spawn(new THREE.Vector3(10,0,0));e.remove(other);assert.equal(events.at(-1).event,'remove');assert.deepEqual(events.at(-1).position,[10,0,0]);
});
test('Hellhound distance switches quiet recovered growl to close pursuit vocal',()=>{
 const {e,events}=realEnemies(),z=e.spawn(new THREE.Vector3(600,0,0),null,'dog'),p=new THREE.Vector3();z.growl=0;e.update(.01,p);assert(events.some(x=>x.id===z.id&&x.event==='ambient'));z.root.position.set(180,0,0);z.growl=0;e.update(.01,p);assert.equal(events.filter(x=>x.id===z.id&&x.event==='sprint').length,1);
});

test('wall occlusion muffles only opted-in creature voices and follows opening a doorway without restarting',async()=>{
 const a=setup();let clear=false,queries=0;a.setOcclusionTest((listener,source)=>{queries++;assert.deepEqual(listener,[0,48,0]);assert(source.every(Number.isFinite));return clear;});
 a.enemy('attack',[100,0,-100],meta(1));await settle();const voice=[...a.voices][0],source=voice.source,occlusion=voice.occlusion;
 assert.equal(occlusion.filter.type,'lowpass');assert(Math.abs(occlusion.filter.frequency.value-850)<.001);assert.equal(occlusion.gain.gain.value,.35);assert.equal(voice.spatialNodes.length,1);assert.equal(a.enemyAudio.snapshot().voices[0].occluded,true);
 clear=true;for(let i=0;i<50;i++){a.ctx.currentTime+=.01;a.enemy('update',[100+i,0,-100],meta(1));}
 assert(queries>=3&&queries<=4,'5 Hz bounded geometry probes');assert.equal(occlusion.gain.gain.value,1);assert.equal(occlusion.filter.frequency.value,18000);assert.equal(occlusion.gain.gain.target.constant,.06);assert.equal([...a.voices][0].source,source);assert.equal(a.enemyAudio.snapshot().voices[0].occluded,false);
 const dry=await a.native('dog',.4,false,{position:[0,0,0]});assert.equal(a.sourceVoices.get(dry).occlusion,undefined,'other callers retain dry output');
 a.enemy('remove',null,meta(1));assert.equal(occlusion.filter.connections.length,0);assert.equal(occlusion.gain.connections.length,0);
});
test('a moving blocked emitter retains its most recent acoustic state when decode completes',async()=>{
 const a=setup();let clear=false,resolve;a.setOcclusionTest(()=>clear);a.buffer=()=>new Promise(r=>resolve=r);
 a.enemy('attack',[100,0,-100],meta(1));clear=true;a.ctx.currentTime+=.21;a.enemy('update',[200,0,-100],meta(1));resolve({length:8000,numberOfChannels:1});await settle();
 const voice=[...a.voices][0];assert.equal(voice.spatialNodes[0].positionX.value,200);assert.equal(voice.occlusion.gain.gain.value,1);assert.equal(a.enemyAudio.snapshot().voices[0].occluded,false);
});
test('surface footfalls are native adaptations, cannot replace a vocal, and use at most three shared creature slots',async()=>{
 const a=setup();assert(enemyFootstepKeys(manifest,'carpet',40).every(k=>k.includes('/run/carpet/')));assert(enemyFootstepKeys(manifest,'wood',180).every(k=>k.includes('/sprint/wood/')));
 a.enemy('attack',[100,0,-100],meta(1));a.enemy('step',[100,0,-100],{...meta(1),surface:'wood',speed:180});for(let id=2;id<=8;id++)a.enemy('step',[100,0,-100],{...meta(id),surface:'metal',speed:40});await settle();
 assert.equal(a.enemyAudio.snapshot().footstepVoices,3);assert.equal(a.enemyAudio.snapshot().active,4);assert(a.enemyAudio.snapshot().voices.some(v=>v.id===1&&v.event==='attack'));
 const footsteps=a.snapshot().recentEvents.filter(e=>e.enemyEvent==='step');assert.equal(footsteps.length,3);assert(footsteps.every(e=>e.native&&e.adaptation==='shared-native-surface-footfall'&&e.playbackRate===1));assert(footsteps.every(e=>e.position[1]===4));
 a.enemy('remove',null,meta(1));assert.equal(a.enemyAudio.snapshot().voices.filter(v=>v.id===1).length,0);await a.reset();assert.equal(a.voices.size,0);assert.equal(a.enemyAudio.snapshot().footstepVoices,0);
});
test('native attack motion reaches its authored impact at the old damage time and finishes before the unchanged cycle ends',()=>{
 const definitions=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
 for(const [kind,name]of [['zombie','ai_zombie_attack_v1'],['nova','ai_zombie_quad_attack'],['dog','zombie_dog_run_attack']]){
  const {e}=realEnemies(),clip=JSON.parse(fs.readFileSync(new URL('../export/web/'+definitions.animations[name],import.meta.url)));e.anims[name]=clip;let hits=0;e.onDamage=()=>hits++;
  const z=e.spawn(new THREE.Vector3(0,0,-40),null,kind),p=new THREE.Vector3(),marker=clip.notifies.find(n=>['fire','dog_melee'].includes(n.name)).time;e.update(.01,p);assert.equal(z.state,'attack');
  e.update(.52,p);assert.equal(hits,0);assert(z.rig.actions.attack.time<marker);
  e.update(.02,p);assert.equal(hits,1);assert(z.rig.actions.attack.time>=marker);assert(z.rig.actions.attack.time<marker+.04);
  e.update(.60,p);assert.equal(z.state,'attack');assert(z.rig.actions.attack.time>clip.duration-.04,'native recovery is not cut off');assert.equal(hits,1,'later authored fire notetrack cannot double damage');
  e.update(.02,p);assert.equal(z.state,'chase');assert.equal(hits,1);
 }
});
test('retimed attacks still miss an escaped or obstructed player and cannot damage twice',()=>{
 for(const reason of ['distance','wall']){const {e}=realEnemies();let hits=0;e.onDamage=()=>hits++;const p=new THREE.Vector3(),z=e.spawn(new THREE.Vector3(0,0,-40));e.update(.01,p);if(reason==='wall')e.world.lineClear=()=>false;else p.set(1000,0,0);e.update(.54,p);e.update(.62,p);assert.equal(hits,0,reason);assert.equal(z.state,'chase');}
});
test('authored footstep notifies emit once per moving step, without double-counting paired native notify names',()=>{
 const {e,events}=realEnemies(),definitions=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));e.anims.ai_zombie_walk_v1=JSON.parse(fs.readFileSync(new URL('../export/web/'+definitions.animations.ai_zombie_walk_v1,import.meta.url)));let probes=0;e.world.surfaceAt=()=>{probes++;return 'wood';};
 const z=e.spawn(new THREE.Vector3(400,0,0)),p=new THREE.Vector3();for(let i=0;i<20;i++)e.update(.02,p);
 const steps=events.filter(x=>x.event==='step');assert.equal(steps.length,1);assert.equal(steps[0].notify,'sndnt#fly_step_zombie');assert.equal(steps[0].surface,'wood');assert.equal(probes,1);
 e.world.closest=()=>z.root.position.clone();z.lastStepPosition.copy(z.root.position);for(let i=0;i<200;i++)e.update(.02,p);assert.equal(events.filter(x=>x.event==='step').length,1,'stationary animation must not shuffle audibly');
 z.root.position.set(800,0,0);z.lastStepPosition.set(700,0,0);e.footstep(z,'sndnt#fly_step_zombie','walk');assert.equal(probes,1,'distant feet do not raycast surfaces');
});
test('a close enemy faces its attack target once and does not track a dodge during the swing',()=>{
 for(const kind of ['zombie','dog','nova'])for(const [x,z]of [[40,0],[0,40],[-40,0],[0,-40]]){
  const {e}=realEnemies(),actor=e.spawn(new THREE.Vector3(),null,kind),player=new THREE.Vector3(x,0,z);actor.root.rotation.y=.37;
  e.update(.01,player);assert.equal(actor.state,'attack');assert.equal(actor.root.rotation.y,Math.atan2(-z,x));
  const committed=actor.root.rotation.y;player.set(z,0,-x);e.update(.2,player);assert.equal(actor.root.rotation.y,committed,'windup must not swivel to follow a dodge');
 }
});

test('seeded vocal shuffle exhausts all eight attack recordings before repeating and preserves actor identity',async()=>{
 const sequence=async seed=>{const a=setup();a.enemyAudio=new EnemyAudio(a,{seed});const events=[];for(let i=0;i<17;i++){a.enemy('attack',[80,0,-100],meta(17));await settle();events.push(a.snapshot().recentEvents.at(-1));a.enemy('remove',null,meta(17));}return events;};
 const first=await sequence(913),replay=await sequence(913),other=await sequence(914);assert.deepEqual(first.map(e=>e.key),replay.map(e=>e.key));assert.notDeepEqual(first.map(e=>e.key),other.map(e=>e.key));
 assert.equal(new Set(first.slice(0,8).map(e=>e.key)).size,8);assert.equal(new Set(first.slice(8,16).map(e=>e.key)).size,8);assert(first.every((e,i)=>!i||e.key!==first[i-1].key));assert.equal(new Set(first.map(e=>e.voiceIdentity)).size,1);assert.equal(new Set(first.map(e=>e.playbackRate)).size,1);
 const identities=Array.from({length:24},(_,i)=>enemyVoiceProfile(i,'zombie',913));assert(identities.every(v=>v.pitch>=.965&&v.pitch<=1.035&&v.level>=.92&&v.level<=1));assert(new Set(identities.map(v=>v.pitch)).size>20);assert(Math.max(...identities.map(v=>v.pitch))-Math.min(...identities.map(v=>v.pitch))>.05,'consecutive IDs must span the available voice range');assert.deepEqual(enemyVoiceProfile(3,'zombie',913),enemyVoiceProfile(3,'zombie',913));
});
test('recording leveling only attenuates louder PCM, caches its scan, and never changes samples or default callers',async()=>{
 const a=setup(),pcm=new Float32Array([.5,-.5,.5,-.5]);let reads=0;const b={length:4,numberOfChannels:1,getChannelData(){reads++;return pcm;}};assert.equal(a.recordingGain(b,.25),.5);assert.equal(a.recordingGain(b,.75),1);assert.equal(reads,1);assert.deepEqual([...pcm],[.5,-.5,.5,-.5]);
 a.buffer=async()=>b;await a.native('dog',.6,false,{levelRms:.25});assert.equal(a.snapshot().recentEvents.at(-1).levelGain,.5);assert.equal([...a.voices].at(-1).gain.gain.value,.3);await a.native('dog',.6);assert.equal([...a.voices].at(-1).gain.gain.value,.6);assert.equal(a.snapshot().recentEvents.at(-1).levelGain,undefined);
});
test('attack replaces a live growl with an 18ms fade and starts only after the predecessor releases its voice slot',async()=>{
 const a=setup();a.enemy('sprint',[0,0,-100],meta(1));await settle();const old=[...a.voices][0],oldSource=old.source;
 a.enemy('attack',[0,0,-100],meta(1));await settle();assert.equal(a.voices.size,1);assert(a.sourceVoices.has(oldSource));assert.equal(a.enemyAudio.snapshot().retiringVoices,1);assert.equal(a.snapshot().recentEvents.at(-1).enemyEvent,'sprint');assert.deepEqual(old.gain.gain.ramps.at(-1),{value:0,time:10.018});assert.equal(old.gain.gain.held,10);
 oldSource.onended();await settle();assert.equal(a.voices.size,1);assert(!a.sourceVoices.has(oldSource));assert.equal(a.enemyAudio.snapshot().retiringVoices,0);assert.equal(a.snapshot().recentEvents.at(-1).enemyEvent,'attack');assert.equal(old.gain.connections.length,0);
 const active=[...a.voices][0];assert.equal(active.gain.gain.ramps[0].time,10.006,'short onset ramp prevents full-amplitude sample starts');assert.equal(active.gain.gain.ramps.at(-1).value,0,'natural end is tapered');
});
test('reset during a release immediately disconnects the old source and prevents its queued replacement',async()=>{
 const a=setup();a.enemy('sprint',[0,0,-100],meta(1));await settle();const old=[...a.voices][0];a.enemy('attack',[0,0,-100],meta(1));assert.equal(a.enemyAudio.snapshot().retiringVoices,1);await a.reset();await settle();assert.equal(a.voices.size,0);assert.equal(a.enemyAudio.snapshot().active,0);assert.equal(a.enemyAudio.snapshot().retiringVoices,0);assert.equal(a.pendingVoices.size,0);assert.equal(old.gain.connections.length,0);assert.equal(a.snapshot().recentEvents.length,0);
});
test('ten interrupted crowd vocals never exceed ten live creature sources and smooth their moving panners',async()=>{
 const a=setup();for(let id=1;id<=10;id++)a.enemy('spawn',[id,0,-100],meta(id));await settle();const old=[...a.voices];for(let id=1;id<=10;id++)a.enemy('attack',[id,0,-100],meta(id));await settle();assert.equal(a.voices.size,10);assert.equal(a.enemyAudio.snapshot().active,10);assert.equal(a.enemyAudio.snapshot().retiringVoices,10);
 for(const voice of old){voice.source.onended();await settle();assert(a.voices.size<=10);}assert.equal(a.voices.size,10);assert.equal(a.enemyAudio.snapshot().retiringVoices,0);
 a.enemy('update',[120,0,-100],meta(1));const voice=[...a.voices].find(v=>v.spatialNodes[0].positionX.value===120);assert(voice);assert.equal(voice.spatialNodes[0].positionX.target.constant,.035);await a.reset();assert.equal(a.voices.size,0);
});
test('an existing attacker can change vocal at the general reserve ceiling without losing its reserved creature slot',async()=>{
 const a=setup();for(let i=0;i<38;i++)a.playAt('impact',[i,0,-100]);a.enemy('attack',[0,0,-100],meta(1));a.enemy('attack',[20,0,-100],meta(2));await settle();assert.equal(a.voices.size,40);a.ctx.currentTime+=.6;
 const old=[...a.voices].find(v=>v.key.startsWith('enemy/'));assert(a.enemy('attack',[0,0,-100],meta(1)),'replacing an actor must reuse its reserved slot');old.source.onended();await settle();assert.equal(a.voices.size,40);assert.equal(a.enemyAudio.snapshot().active,2);assert.equal(a.maxVoices-a.voices.size,8);
});
