import { resolveChromeExecutable } from './browser-path.mjs';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const out=path.resolve(process.env.KINO_TEST_OUT??path.join(root,'artifacts/traps'));
fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'export/web/game-data.json'),'utf8'));
const authored=data.entities.filter(e=>e.targetname==='zombie_trap'&&e.bounds);
const switches=name=>data.entities.filter(e=>e.classname==='trigger_use'&&e.targetname===name);
const sources=name=>data.entities.filter(e=>e.classname==='script_struct'&&e.targetname===name);
const power=data.entities.find(e=>e.targetname==='use_elec_switch'&&e.classname==='trigger_use');
const jug=data.entities.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_armorvest');
const views={
  dressing_room_trap:[[1175,-9,-1529],[1016,60,-1529]],
  control_room_trap:[[-1460,169,-1485],[-1460,240,-1290]],
  foyer_room_trap:[[0,110,535],[0,110,352]],
  crematorium_room_trap:[[-920,80,860],[-920,140,638]],
  vip_room_trap:[[1140,330,768],[964,375,768]],
};
const checks=[],errors=[],externalRequests=[];
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
const page=await context.newPage();
page.on('pageerror',e=>errors.push({kind:'script',message:String(e)}));
page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',message:m.text()});});
page.on('requestfailed',r=>errors.push({kind:'request',url:r.url(),message:r.failure()?.errorText}));
page.on('response',r=>{if(r.status()>=400)errors.push({kind:'http',url:r.url(),status:r.status()});});
page.on('request',r=>{if(/^https?:/.test(r.url())&&!['127.0.0.1','localhost'].includes(new URL(r.url()).hostname))externalRequests.push(r.url());});
const state=()=>page.evaluate(()=>kino.debug.getState());
const traps=()=>page.evaluate(()=>kino.debug.trapState());
const step=seconds=>page.evaluate(seconds=>kino.debug.step(seconds),seconds);
const pass=(name,evidence={})=>{checks.push({name,passed:true,...evidence});console.log('PASS',name);};
const trap=async name=>(await traps()).find(t=>t.name===name);
const identities=s=>s.map(t=>({name:t.name,objectId:t.objectId,geometryId:t.geometryId,vertexCount:t.vertexCount}));
let initialResources;
async function fresh(){
  const resetAudio=await page.evaluate(()=>{kino.debug.reset();const resetAudio=kino.debug.audioState();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.grantPoints(30000);kino.debug.teleportPlayer([0,100,1120]);return resetAudio;});
  assert.equal(resetAudio.spatialVoices,0,'reset stops spatial trap and NPC voices');
  await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(.5);
  const t=await traps();assert(t.every(t=>!t.active&&!t.visible&&t.cooldown===0));assert.deepEqual(identities(t),initialResources,'reset reuses the same five effect objects and geometries');
}
async function use(e){
  await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.step(.15);},e.position);
  const probe=await page.evaluate(id=>kino.debug.interactionProbe(id),e.id);
  assert.equal(probe.promptId,e.id,'visible authored switch is selected: '+e.id);
  await page.keyboard.press('KeyF');return state();
}
async function enable(){await use(power);assert((await state()).power);}
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png')});}
async function setup(name){await fresh();await enable();await use(switches(name)[0]);assert((await trap(name)).active);}

try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000});
  await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
  const initial=await traps();assert.equal(initial.length,5);assert(initial.every(t=>Number.isInteger(t.objectId)&&t.geometryId&&t.vertexCount>0),'resource diagnostics must expose actual effect identity');
  initialResources=identities(initial);
  for(const e of authored){
    const name=e.target,handles=switches(name),inside=sources(name)[0].position;
    assert.equal(handles.length,2,name+' has opposite authored switches');
    await fresh();let before=await state();await use(handles[0]);assert.equal((await state()).points,before.points);assert(!(await trap(name)).active,'unpowered trap rejects activation');
    await enable();before=await state();await use(handles[0]);let t=await trap(name);
    assert(t.active&&t.visible);assert(t.remaining>39&&t.remaining<=40);assert(t.cooldown>99&&t.cooldown<=100);assert.equal((await state()).points,before.points-1000);
    const charged=(await state()).points;await use(handles[0]);await use(handles[1]);assert.equal((await state()).points,charged);assert.deepEqual(identities(await traps()),initialResources);
    const sound=await page.evaluate(()=>kino.debug.audioState());
    assert(sound.recentEvents.some(event=>event.key==='trap/'+t.type&&event.native===false&&event.position),'active trap has a spatial replacement sound');
    assert(sound.spatialVoices>0);assert(sound.voices<=sound.maxVoices);
    pass(name+' uses both authored switches, requires power, charges once and starts source timers',{type:t.type,remaining:t.remaining,cooldown:t.cooldown,emitters:t.emitters});

    const remote=handles.find(h=>h.position[0]<e.bounds[0][0]-20||h.position[0]>e.bounds[1][0]+20||h.position[2]<e.bounds[0][2]-20||h.position[2]>e.bounds[1][2]+20);
    assert(remote,name+' has a remote switch outside the hazard');
    const outside=remote.position.map((n,i)=>n-(i===1?45:0));
    const damageResult=await page.evaluate(({inside,outside})=>{
      const before=kino.debug.getState(),hazardId=kino.debug.spawnEnemy(inside),remoteId=kino.debug.spawnEnemy(outside);
      kino.debug.step(.08);const after=kino.debug.getState();
      return {before,after,hazardId,remoteId,pickups:kino.debug.specialState().pickups};
    },{inside,outside});
    assert(!damageResult.after.enemies.some(z=>z.id===damageResult.hazardId),'enemy in authored hazard is killed');
    const survivor=damageResult.after.enemies.find(z=>z.id===damageResult.remoteId);assert(survivor,'enemy near remote switch survives');assert.equal(survivor.health,150);
    assert.equal(damageResult.after.points,damageResult.before.points);assert.equal(damageResult.after.totalScore,damageResult.before.totalScore);assert.equal(damageResult.after.kills,damageResult.before.kills+1);assert.equal(damageResult.after.killed,damageResult.before.killed+1);assert.equal(damageResult.pickups.length,0);
    pass(name+' kills in the actual hazard, preserves the remote-switch NPC, counts the kill without score or a drop',{inside,outside,survivor:survivor.position});

    const [feet,target]=views[name];await page.evaluate(({feet,target})=>{kino.debug.teleportPlayer(feet);kino.debug.step(.2);kino.debug.lookAt(target);},{feet,target});
    await page.waitForTimeout(200);await screenshot(name);
    await page.evaluate(()=>kino.debug.pause());const paused=await state(),pausedTrap=await trap(name);await step(5);await page.waitForTimeout(250);
    assert.equal((await state()).time,paused.time);assert.equal((await trap(name)).remaining,pausedTrap.remaining);
    assert.equal(await page.evaluate(()=>kino.debug.audioState().state),'suspended','pause suspends the audio context');
    await page.evaluate(()=>kino.debug.resume());await step((await trap(name)).remaining+.1);t=await trap(name);assert(!t.active&&!t.visible);assert(t.cooldown>59&&t.cooldown<=60);
    const cooledPoints=(await state()).points;await use(handles[1]);assert.equal((await state()).points,cooledPoints);assert(!(await trap(name)).active);
    await step((await trap(name)).cooldown+.1);await use(handles[1]);assert((await trap(name)).active);assert.equal((await state()).points,cooledPoints-1000);assert.deepEqual(identities(await traps()),initialResources);
    pass(name+' pauses its timer, expires its effect, rejects cooldown use and reuses its resources when reactivated');
  }

  for(const name of ['dressing_room_trap','crematorium_room_trap']){
    const inside=sources(name)[0].position;
    await setup(name);
    const lethal=await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.setInvulnerable(false);kino.debug.step(.02);return kino.debug.getState();},inside);
    assert.equal(lethal.phase,'gameover');assert.equal(lethal.health,0);
    pass(name+' immediately kills an unprotected player in the authored volume');

    await fresh();await enable();await use(jug);let s=await state();assert(s.drinking);await step(s.drinkLeft+.1);assert.equal((await state()).health,250);await use(switches(name)[0]);
    const protectedDamage=await page.evaluate(p=>{
      kino.debug.teleportPlayer(p);kino.debug.setInvulnerable(false);kino.debug.step(.001);const first=kino.debug.getState();
      kino.debug.step(.045);const early=kino.debug.getState();kino.debug.step(.07);const second=kino.debug.getState();
      return {first:{health:first.health,time:first.time,phase:first.phase},early:{health:early.health,time:early.time},second:{health:second.health,time:second.time}};
    },inside);
    const contactDamage=name==='dressing_room_trap'?16:25;
    assert.equal(protectedDamage.first.health,250-contactDamage);assert.notEqual(protectedDamage.first.phase,'gameover');assert.equal(protectedDamage.early.health,250-contactDamage);assert.equal(protectedDamage.second.health,250-2*contactDamage);
    pass(name+' applies '+contactDamage+' Juggernog damage at the source 0.1-second cadence',{samples:protectedDamage});
  }
  await fresh();for(let i=0;i<4;i++)await page.evaluate(()=>kino.debug.reset());assert.deepEqual(identities(await traps()),initialResources);assert((await traps()).every(t=>!t.visible&&!t.active&&t.cooldown===0));
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
  pass('Repeated restart leaves exactly the original five bounded trap effects; no browser or asset errors');
}catch(error){
  console.error(error);process.exitCode=1;
  checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack,state:await state().catch(()=>null),traps:await traps().catch(()=>null)});
  await screenshot('failure').catch(()=>{});
}finally{
  await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(false);}).catch(()=>{});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({method:'Isolated Chrome browser; actual keyboard purchases and map line of sight. Debug placement, enemy spawn, invulnerability and accelerated time provide controlled acceptance cases; no performance claim.',checks,errors,externalRequests},null,2));
  await context.close();await browser.close();
}
