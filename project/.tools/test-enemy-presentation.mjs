import {chromium} from 'playwright-core';
import {resolveChromeExecutable} from './browser-path.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const out=process.env.KINO_ENEMY_PRESENTATION_OUT??'artifacts/v5-audio-enemies';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];let pcm=[],poses=[];
page.on('pageerror',e=>{errors.push(String(e));console.error('PAGE ERROR',String(e));});page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const fresh=()=>page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.teleportPlayer([0,100,1120]);kino.debug.lookAt([0,135,800]);kino.debug.step(.7);});
try{
 console.log('Loading current source');const loadingFailure=new Promise((_,reject)=>page.once('pageerror',reject));await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await Promise.race([page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000}),loadingFailure]);console.log('Map ready');await page.click('#start');await fresh();console.log('Rendering recorded PCM');
 pcm=await page.evaluate(async()=>{
  const {GameAudio}=await import('./audio.js'),output=[];
  for(const occlusion of [0,1]){
   const a=new GameAudio();await a.load();a.ctx=new OfflineAudioContext(2,144000,48000);a.master=a.ctx.createGain();a.master.gain.value=.42;a.master.connect(a.ctx.destination);a.setListener([0,48,0]);
   const key='enemy/nzp/zombie/a0';await a.native(key,.58,false,{position:[-200,48,-200],occlusion});const buffer=await a.ctx.startRendering();let power=0,difference=0,peak=0;
   for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<data.length;i++){power+=data[i]**2;difference+=(data[i]-(data[i-1]??0))**2;peak=Math.max(peak,Math.abs(data[i]));}}
   output.push({key,occlusion,rms:Math.sqrt(power/(buffer.length*2)),differenceRms:Math.sqrt(difference/(buffer.length*2)),peak,seconds:buffer.duration,channels:buffer.numberOfChannels});
  }return output;
 });
 assert(pcm[0].rms>0&&pcm[1].rms>0);assert(pcm[1].rms<pcm[0].rms*.38);assert(pcm[1].differenceRms/pcm[1].rms<pcm[0].differenceRms/pcm[0].rms*.8);assert(pcm.every(p=>p.peak<=1&&Number.isFinite(p.rms)));
 pass('Actual rendered stereo PCM is quieter and spectrally muffled through a wall; no human listening claim',pcm);
 for(const kind of ['zombie','dog','nova']){
  await fresh();const id=await page.evaluate(kind=>{const p=kino.debug.getState().player.feet;return kino.debug.spawnEnemy([p[0],p[1],p[2]-220],kind);},kind);
  await page.evaluate(()=>kino.debug.step(.9));await page.waitForFunction(id=>kino.debug.audioState().recentEvents.some(e=>e.enemyId===id&&e.enemyEvent==='step'),id,{timeout:10000});
  const event=await page.evaluate(id=>kino.debug.audioState().recentEvents.find(e=>e.enemyId===id&&e.enemyEvent==='step'),id);assert(event.native);assert.equal(event.adaptation,'shared-native-surface-footfall');assert.equal(event.enemyKind,kind);assert.match(event.key,/^shared\/fly\/footsteps\//);assert.equal(event.channel,'effects');pass(kind+' actual moving rig emits a spatial native surface footfall',event);
 }
 await fresh();const acoustics=await page.evaluate(()=>{
  const p=kino.debug.getState().player.feet,positions=[[p[0],p[1],p[2]-100],...kino.debug.spawnCandidates().slice(0,5).map(b=>b.outside)];
  const ids=positions.map(pos=>kino.debug.spawnEnemy(pos,'zombie'));kino.debug.pause();return{ids,voices:kino.debug.audioState().enemy.voices};
 });
 assert(acoustics.voices.some(v=>!v.occluded));assert(acoustics.voices.some(v=>v.occluded),'actual geometry must occlude at least one natural exterior spawn');pass('Real Kino geometry distinguishes open lobby emitter from exterior spawns',acoustics);
 for(const kind of ['zombie','dog','nova']){
  const samples=[];
  for(const [label,elapsed]of [['windup',.3],['impact',.55],['recovery',1.12]]){
   await fresh();const sample=await page.evaluate(({kind,elapsed})=>{
    const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-40],kind);kino.debug.step(.01);kino.debug.step(elapsed);kino.debug.aimAtEnemy(id,false);kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');return kino.debug.getState().enemies.find(z=>z.id===id);
   },{kind,elapsed});assert.equal(sample.state,'attack');assert.equal(sample.animation,'attack');assert(sample.attackPoseTime>0);await page.screenshot({path:out+'/'+kind+'-'+label+'.png'});samples.push({label,...sample});
  }
  assert(samples[0].attackPoseTime<samples[1].attackPoseTime);assert(samples[1].attackPoseTime<samples[2].attackPoseTime);poses.push({kind,samples});pass(kind+' actual native attack advances through windup, authored impact and recovery',samples.map(s=>({label:s.label,simulation:s.attackElapsed,pose:s.attackPoseTime})));
 }
 await page.evaluate(()=>kino.debug.reset());await page.waitForTimeout(150);const cleaned=await page.evaluate(()=>kino.debug.audioState());assert.equal(cleaned.voices,0);assert.equal(cleaned.musicVoices,0);assert.equal(cleaned.pendingVoices,0);assert.equal(cleaned.enemy.active,0);pass('Reset disconnects vocal, footfall, occlusion, music and pending voices');
 assert.equal(errors.length,0,errors.join('\n'));pass('No script, shader, decode or failed-request errors');
}catch(error){checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(out+'/presentation-report.json',JSON.stringify({checks,errors,pcm,poses},null,2));await browser.close();}
