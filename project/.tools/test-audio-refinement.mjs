import {chromium} from 'playwright-core';
import {resolveChromeExecutable} from './browser-path.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.KINO_AUDIO_REFINEMENT_OUT??'artifacts/v6-audio';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}),checks=[],errors=[];let pcm,demo,live;
page.on('pageerror',e=>{errors.push(String(e));console.error(String(e));});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
function wav(channels,sampleRate){const length=channels[0].length,data=Buffer.alloc(44+length*channels.length*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(channels.length,22);data.writeUInt32LE(sampleRate,24);data.writeUInt32LE(sampleRate*channels.length*2,28);data.writeUInt16LE(channels.length*2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);let offset=44;for(let i=0;i<length;i++)for(const channel of channels){data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channel[i]))*32767),offset);offset+=2;}return data;}
try{
 const base=process.env.KINO_URL??'http://127.0.0.1:5173/';await page.route(base+'audio-refinement-harness',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Controlled creature mixer</title>'}));await page.goto(base+'audio-refinement-harness');console.log('Rendering controlled real-mixer audio');
 pcm=await page.evaluate(async()=>{
  const {GameAudio}=await import('/audio.js'),result=[];
  const manifest=await(await fetch('/audio/manifest.json')).json();for(const item of Object.values(manifest))item.url='/'+item.url;
  for(const fade of [0,.018]){
   const a=new GameAudio();a.manifest=manifest;a.ctx=new OfflineAudioContext(2,96000,48000);a.master=a.ctx.createGain();a.master.gain.value=.42;a.master.connect(a.ctx.destination);a.setListener([0,48,0]);
   const source=await a.native('enemy/nzp/zombie/r0',.58,false,{position:[-100,48,-160],envelope:true,levelRms:.26});const held=a.ctx.suspend(.5),render=a.ctx.startRendering();await held;const boundary=a.ctx.currentTime;a.stopSource(source,fade);await a.ctx.resume();const b=await render;
   const channels=[...Array(b.numberOfChannels)].map((_,c)=>Array.from(b.getChannelData(c))),index=Math.round(boundary*b.sampleRate);let jump=0,peak=0,power=0;
   for(const data of channels){for(let i=index-1;i<=index+1;i++)jump=Math.max(jump,Math.abs(data[i]-data[i-1]));for(const n of data){peak=Math.max(peak,Math.abs(n));power+=n*n;}}
   result.push({fade,boundary,jump,peak,rms:Math.sqrt(power/(b.length*b.numberOfChannels)),samplesAtCutoff:channels.map(c=>c.slice(index-3,index+4))});
  }return result;
 });
 assert(pcm.every(p=>p.rms>0&&p.peak<1));assert(pcm[1].jump<pcm[0].jump*.35,'soft replacement must reduce the measured cutoff discontinuity');pass('Actual PCM replacement taper reduces abrupt waveform cutoff without clipping',pcm);
 demo=await page.evaluate(async()=>{
  const {GameAudio}=await import('/audio.js'),{EnemyAudio}=await import('/enemy-audio.js'),a=new GameAudio();a.manifest=await(await fetch('/audio/manifest.json')).json();for(const item of Object.values(a.manifest))item.url='/'+item.url;
  a.ctx=new OfflineAudioContext(2,14*48000,48000);a.master=a.ctx.createGain();a.master.gain.value=.42;a.master.connect(a.ctx.destination);a.setListener([0,48,0]);a.setOcclusionTest((listener,position)=>position[0]<500);a.enemyAudio=new EnemyAudio(a,{seed:1505});
  await Promise.all(Object.keys(a.manifest).filter(k=>k.startsWith('enemy/nzp/')).map(k=>a.buffer(k)));
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const schedule=[{at:0,label:'near left approach call',id:11,event:'sprint',p:[-100,0,-180]},{at:.5,label:'same actor interrupts approach with attack',id:11,event:'attack',p:[-100,0,-180]},{at:.56,label:'release processing boundary'},{at:1.7,label:'same actor, different attack recording',id:11,event:'attack',p:[-100,0,-180]},{at:3.2,label:'different actor on right',id:12,event:'attack',p:[120,0,-180]},{at:4.8,label:'distant clear actor on left',id:13,event:'attack',p:[-850,0,-650]},{at:6.4,label:'wall-obstructed actor on right',id:14,event:'attack',p:[520,0,-100]},{at:8,label:'near Nova adaptation',id:15,kind:'nova',event:'attack',p:[80,0,-200]},{at:9.6,label:'near Hellhound',id:16,kind:'dog',event:'attack',p:[-140,0,-160]},{at:11,label:'small crowd with distinct voices',id:17,event:'attack',p:[-130,0,-190]},{at:11.16,label:'small crowd second voice',id:18,event:'attack',p:[140,0,-210]}];
  const apply=item=>{if(item.event)a.enemy(item.event,item.p,{id:item.id,kind:item.kind??'zombie'});};apply(schedule[0]);await settle();
  const pauses=schedule.slice(1).map(item=>({item,held:a.ctx.suspend(item.at)})),render=a.ctx.startRendering();let maximum=0;
  for(const {item,held}of pauses){await held;apply(item);await settle();maximum=Math.max(maximum,a.voices.size);await a.ctx.resume();}
  const b=await render,channels=Array.from({length:b.numberOfChannels},(_,c)=>Array.from(b.getChannelData(c)));let peak=0,power=0;for(const data of channels)for(const n of data){peak=Math.max(peak,Math.abs(n));power+=n*n;}
  return{sampleRate:b.sampleRate,seconds:b.duration,channels,peak,rms:Math.sqrt(power/(b.length*b.numberOfChannels)),maximumVoices:maximum,schedule,events:a.snapshot().recentEvents};
 });
 assert.equal(demo.seconds,14);assert(demo.peak<1&&demo.rms>0);assert(demo.events.some(e=>e.occluded));assert(demo.events.some(e=>e.enemyKind==='nova'));assert(demo.events.some(e=>e.enemyKind==='dog'));const same=demo.events.filter(e=>e.enemyId===11);assert.equal(same.length,3);assert.equal(new Set(same.map(e=>e.voicePitch)).size,1);assert.notEqual(same[1].key,same[2].key);assert(demo.events.every(e=>e.levelGain<=1&&e.voicePitch>=.965&&e.voicePitch<=1.035));
 fs.writeFileSync(out+'/creature-mixer-demo.wav',wav(demo.channels,demo.sampleRate));delete demo.channels;pass('Saved 14-second stereo mixer demonstration: identities, transitions, near/far, wall muffling, Nova and Hellhound',demo);
 const loadingFailure=new Promise((_,reject)=>page.once('pageerror',reject));await page.goto(base);await Promise.race([page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000}),loadingFailure]);await page.click('#start');
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.teleportPlayer([0,100,1120]);kino.debug.step(.7);});
 const id=await page.evaluate(()=>{const p=kino.debug.getState().player.feet;return kino.debug.spawnEnemy([p[0],p[1],p[2]-40],'zombie');});await page.evaluate(()=>kino.debug.step(.03));await page.waitForFunction(id=>kino.debug.audioState().recentEvents.some(e=>e.enemyId===id&&e.enemyEvent==='attack'),id);
 const attack=await page.evaluate(id=>kino.debug.audioState().recentEvents.find(e=>e.enemyId===id&&e.enemyEvent==='attack'),id);assert(attack.voicePitch>=.965&&attack.voicePitch<=1.035);assert(attack.levelGain>0&&attack.levelGain<=1);
 await page.evaluate(id=>kino.debug.damageEnemy(id),id);await page.waitForFunction(id=>kino.debug.audioState().recentEvents.some(e=>e.enemyId===id&&e.enemyEvent==='death'),id);const death=await page.evaluate(id=>kino.debug.audioState().recentEvents.find(e=>e.enemyId===id&&e.enemyEvent==='death'),id);assert.equal(attack.voiceIdentity,death.voiceIdentity);assert.equal(attack.voicePitch,death.voicePitch);pass('Actual gameplay attack and death preserve the same restrained actor voice and recording levels',{attack,death});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForFunction(()=>kino.debug.audioState().state==='suspended');const held=await page.evaluate(()=>kino.debug.audioState());await page.waitForTimeout(150);assert.deepEqual((await page.evaluate(()=>kino.debug.audioState())).recentEvents,held.recentEvents);await page.evaluate(()=>kino.debug.resume());await page.waitForFunction(()=>kino.debug.audioState().state==='running');await page.evaluate(()=>kino.debug.reset());await page.waitForTimeout(50);live=await page.evaluate(()=>kino.debug.audioState());assert.equal(live.voices,0);assert.equal(live.enemy.active,0);assert.equal(live.enemy.retiringVoices,0);assert.equal(live.pendingVoices,0);pass('Actual window blur pauses input/audio; resume restores playback and reset cancels all creature sources');
 assert.equal(errors.length,0,errors.join('\n'));pass('No script, decode, shader or failed-request errors');
}catch(error){checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,pcm,demo,live},null,2));await browser.close();}
