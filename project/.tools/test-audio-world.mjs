import { chromium } from 'playwright-core';
import { resolveChromeExecutable } from './browser-path.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out=process.env.KINO_AUDIO_OUT??'artifacts/second-pass-audio';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];let decoded=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
const audio=()=>page.evaluate(()=>kino.debug.audioState());
const step=seconds=>page.evaluate(n=>kino.debug.step(n),seconds);
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const waitCue=prefix=>page.waitForFunction(prefix=>kino.debug.audioState().recentEvents.some(e=>e.key.startsWith(prefix)),prefix,{timeout:15000});
async function fresh(){await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.teleportPlayer([0,100,1120]);kino.debug.lookAt([0,150,800]);});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(.8);}
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await fresh();
  decoded=await page.evaluate(async()=>{
    const {GameAudio}=await import('./audio.js'),a=new GameAudio();await a.load();a.ctx=new AudioContext();
    const keys=[...Object.keys(a.manifest).filter(k=>k.startsWith('shared/')),'dog_announce','full_ammo','insta_kill','double_points','nuke','carpenter','fire_sale'];
    try{return await Promise.all(keys.map(async key=>{const b=await a.buffer(key),samples=b.getChannelData(0);let power=0,peak=0;for(const sample of samples){power+=sample*sample;peak=Math.max(peak,Math.abs(sample));}return{key,duration:b.duration,channels:b.numberOfChannels,sampleRate:b.sampleRate,rms:Math.sqrt(power/samples.length),peak};}));}finally{await a.ctx.close();}
  });
  assert.equal(decoded.filter(d=>d.key.startsWith('shared/')).length,72);assert.equal(decoded.length,79);assert(decoded.every(d=>d.duration>0&&d.channels>=1&&d.sampleRate>0&&d.rms>0&&d.peak>0));pass('72 shared cues and 7 native announcer recordings decode to nonzero PCM (automated check)',decoded.length);
  const stereo=await page.evaluate(async()=>{
    const {GameAudio}=await import('./audio.js'),sides=[];
    for(const x of [-240,240]){
      const a=new GameAudio();await a.load();a.ctx=new OfflineAudioContext(2,48000,48000);a.master=a.ctx.createGain();a.master.gain.value=.42;a.master.connect(a.ctx.destination);a.setListener([0,0,0],[0,0,-1]);
      await a.native('shared/wpn/grenade/explosion/explode/explode_00',1,false,{position:[x,0,-240]});const rendered=await a.ctx.startRendering();
      sides.push([0,1].map(channel=>{const samples=rendered.getChannelData(channel);let power=0;for(const s of samples)power+=s*s;return Math.sqrt(power/samples.length);}));
    }return sides;
  });
  assert(stereo[0][0]>stereo[0][1]*1.1,'left emitter has stronger left-channel PCM');assert(stereo[1][1]>stereo[1][0]*1.1,'right emitter has stronger right-channel PCM');pass('Actual Web Audio HRTF output follows left/right source position (automated PCM analysis)',stereo);
  await page.keyboard.down('KeyW');await step(1.15);await page.keyboard.up('KeyW');await page.waitForFunction(()=>kino.debug.audioState().recentEvents.some(e=>e.key.startsWith('shared/fly/footsteps/')&&!e.key.includes('/land/')),null,{timeout:15000});
  const walking=(await audio()).recentEvents.filter(e=>e.key.startsWith('shared/fly/footsteps/')&&!e.key.includes('/land/'));assert(walking.length>0);assert(walking.every(e=>e.native));pass('Actual walking input emits native surface footsteps',walking);
  await fresh();await waitCue('shared/fly/footsteps/land/');const landCount=(await audio()).recentEvents.filter(e=>e.key.includes('/land/')).length;await page.evaluate(()=>{const p=kino.debug.getState().player.feet;kino.debug.teleportPlayer([p[0],p[1]+100,p[2]]);});await step(1.2);await page.waitForFunction(count=>kino.debug.audioState().recentEvents.filter(e=>e.key.includes('/land/')).length>count,landCount,{timeout:15000});pass('Air-to-ground movement emits a native landing cue',(await audio()).recentEvents.filter(e=>e.key.includes('/land/')));
  await fresh();await page.evaluate(()=>kino.debug.giveWeapon('ray_gun_zm'));await page.waitForFunction(()=>kino.debug.getState().viewmodelReady&&kino.debug.weaponVisual().mode==='idle');
  await page.evaluate(()=>{const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-210]);kino.debug.aimAtEnemy(id,false);});assert(await page.evaluate(()=>kino.debug.shoot()));await step(.5);await waitCue('shared/wpn/energy/raygun/projectile/impact/');
  const ray=(await audio()).recentEvents.find(e=>e.key.startsWith('shared/wpn/energy/raygun/projectile/impact/'));assert(ray.native&&ray.position?.length===3);pass('Ray Gun collision emits its native positional impact',ray);
  await fresh();await page.keyboard.press('KeyG');await step(4);await waitCue('shared/wpn/grenade/explosion/explode/');const grenade=(await audio()).recentEvents.find(e=>e.key.startsWith('shared/wpn/grenade/explosion/explode/'));assert(grenade.native&&grenade.position?.length===3);pass('Thrown grenade emits a native positional blast',grenade);
  await fresh();await page.evaluate(()=>kino.debug.collectPowerup('full_ammo'));await waitCue('full_ammo');const announcer=(await audio()).recentEvents.find(e=>e.key==='full_ammo');assert(announcer.native&&announcer.channel==='dialogue');pass('Native Max Ammo announcer uses the dialogue mix bus',announcer);
  await fresh();await page.evaluate(()=>{kino.debug.giveMonkeys();kino.debug.lookAt([0,110,850]);});assert(await page.evaluate(()=>kino.debug.useEquipment('monkeys')));await step(3);await waitCue('shared/wpn/monkey/monkey_song_');
  const monkey=(await audio()).recentEvents.find(e=>e.key.startsWith('shared/wpn/monkey/monkey_song_'));assert(monkey.native&&monkey.position?.length===3);assert((await audio()).spatialVoices>=1);pass('Grounded Monkey Bomb plays an original song from the lure',monkey);
  await step(6);assert.equal((await page.evaluate(()=>kino.debug.completionState())).projectiles.length,0);await page.evaluate(()=>kino.debug.reset());
  const stopped=await audio();assert.equal(stopped.voices,0);assert.equal(stopped.musicVoices,0);assert.equal(stopped.spatialVoices,0);assert.equal(stopped.pendingVoices,0);pass('Detonation and restart clean positional voices and pending audio',stopped);
  await fresh();await page.screenshot({path:out+'/gameplay.png'});assert.equal(errors.length,0,errors.join('\n'));pass('Browser reports no script, decode or network failures');
}catch(e){checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack});console.error(e);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(out+'/browser-report.json',JSON.stringify({checks,errors,decoded,audio:await audio().catch(()=>null)},null,2));await browser.close();}
