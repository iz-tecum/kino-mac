// Earned progression through ordinary inputs, collision, enemies and economy.
// Only observation, camera targeting and navigation queries use debug APIs.
// This is an automated playtest, not a human playthrough. Every attempt is kept.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';

const out=process.env.KINO_PROGRESSION_OUT??'artifacts/normal-progression';
const attempt=path.join(out,'attempt-'+new Date().toISOString().replaceAll(':','-').replaceAll('.','-'));
fs.mkdirSync(attempt,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:process.env.KINO_HEADED!=='1'});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[],events=[],trace=[],held=new Set(),blocked=new Map();
let ads=false,startedAt=0,lastTrace=0,lastRound=0,lastPhase='',lastCheckpoint=0,entities=[],deadline=0;
const budget=Number(process.env.KINO_PROGRESSION_SECONDS??1200)*1000;
const state=()=>page.evaluate(()=>kino.debug.getState());
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const summary=s=>({time:s.time,round:s.round,phase:s.phase,health:s.health,maxHealth:s.maxHealth,points:s.points,kills:s.kills,headshots:s.headshots,weapon:s.weapon,perks:s.perks,openDoors:s.openDoors,power:s.power,teleporter:s.teleporter,pack:s.pack,feet:s.player?.feet,prompt:s.prompt});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
async function movement(wanted=[]){
  const next=new Set(wanted);
  for(const key of [...held])if(!next.has(key)){await page.keyboard.up(key);held.delete(key);}
  for(const key of next)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
}
async function aim(value){if(ads===value)return;ads=value;await page.mouse[value?'down':'up']({button:'right'});}
async function monitor(){
  const s=await state();assert.notEqual(s.phase,'gameover','Player died during earned progression');
  assert(s.active,'Gameplay unexpectedly paused');assert(Date.now()<deadline,'Progression time budget exhausted');
  if(s.round!==lastRound||s.phase==='reviving'&&lastPhase!=='reviving'){
    lastRound=s.round;events.push({event:s.phase==='reviving'?'Normal enemy damage caused a paid revive':'Round '+s.round,...summary(s)});
    console.log(JSON.stringify({progress:'round',round:s.round,time:s.time,kills:s.kills,points:s.points,health:s.health,phase:s.phase}));
  }
  lastPhase=s.phase;
  if(s.time-lastTrace>=1){lastTrace=s.time;trace.push({time:s.time,wallSeconds:(Date.now()-startedAt)/1000,feet:s.player.feet,health:s.health,points:s.points,kills:s.kills,round:s.round,weapon:s.weapon.id});}
  if(Date.now()-lastCheckpoint>20000){
    lastCheckpoint=Date.now();console.log(JSON.stringify({progress:'playing',...summary(s)}));
    fs.writeFileSync(path.join(attempt,'checkpoint.json'),JSON.stringify({status:'running',events,trace,state:summary(s),errors},null,2));
  }
  return s;
}
async function milestone(name){
  const s=await monitor();events.push({event:name,...summary(s)});console.log(JSON.stringify({milestone:name,...summary(s)}));
  await page.screenshot({path:path.join(attempt,String(events.length).padStart(2,'0')+'-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.png')});
  return s;
}
async function steer(destination,targetId=null){
  const rotation=await page.evaluate(({destination,targetId})=>{
    if(targetId!==null)kino.debug.aimAtEnemy(targetId);
    else if(destination){const s=kino.debug.getState();kino.debug.lookAt([destination[0],s.player.position[1],destination[2]]);}
    return kino.debug.getState().player.rotation[1];
  },{destination,targetId});
  if(!destination){await movement();return;}
  const s=await state(),dx=destination[0]-s.player.feet[0],dz=destination[2]-s.player.feet[2],length=Math.hypot(dx,dz);
  if(length<16){await movement();return;}
  const forward=(-Math.sin(rotation)*dx-Math.cos(rotation)*dz)/length,right=(Math.cos(rotation)*dx-Math.sin(rotation)*dz)/length;
  const keys=[];if(forward>.3)keys.push('KeyW');else if(forward<-.3)keys.push('KeyS');
  if(right>.3)keys.push('KeyD');else if(right<-.3)keys.push('KeyA');
  if(targetId===null&&keys.includes('KeyW'))keys.push('ShiftLeft');await movement(keys);
}
async function combatTick(s,destination=null){
  if(s.phase==='reviving'||s.drinking){await aim(false);await movement();await page.waitForTimeout(100);return;}
  const enemies=s.enemies.filter(z=>['chase','attack','entering'].includes(z.state)).map(z=>({...z,distance:distance(z.position,s.player.feet)})).sort((a,b)=>a.distance-b.distance);
  const target=enemies.find(z=>z.distance<1400&&(blocked.get(z.id)??0)<=s.time);
  if(!s.reloadLeft&&s.weapon.reserve>0&&(s.weapon.mag===0||s.weapon.mag<=2&&(!enemies[0]||enemies[0].distance>420))){await aim(false);await page.keyboard.press('KeyR');}
  if(target&&!s.reloadLeft&&s.weapon.mag>0&&s.viewmodelReady){
    await aim(true);await steer(destination,target.id);await page.mouse.click(640,400,{delay:30});await page.waitForTimeout(75);
    const shot=await page.evaluate(()=>kino.debug.lastShot());
    if(shot?.target?.id!==target.id)blocked.set(target.id,s.time+.8);
  }else{
    await aim(false);await steer(destination);
    if(!s.weapon.mag&&!s.weapon.reserve&&enemies[0]?.distance<85)await page.keyboard.press('KeyV');
    await page.waitForTimeout(80);
  }
}
async function walkTo(entity,promptPattern=null,{timeout=90000}={}){
  const began=Date.now(),target=entity.position??entity;let route=[],index=1,routedAt=0,stuckAt=Date.now(),previous=null;
  while(Date.now()-began<timeout){
    const s=await monitor(),near=distance(s.player.feet,target)<(promptPattern?105:22);
    if(near&&(!promptPattern||promptPattern.test(s.prompt))){await movement();await aim(false);return s;}
    if(!route.length||index>=route.length||Date.now()-routedAt>5000){
      route=await page.evaluate(target=>kino.debug.navigationPath(kino.debug.getState().player.feet,target),target);
      assert(route.length,'No walkable navigation route to '+(entity.targetname??target));index=route.length>1?1:0;routedAt=Date.now();
    }
    while(index<route.length-1&&distance(s.player.feet,route[index])<22)index++;
    const waypoint=route[index]??target;
    if(previous&&distance(previous,s.player.feet)<8&&Date.now()-stuckAt>1800){
      // A real jump can clear a small collision lip; no position edits are used.
      await page.keyboard.press('Space',{delay:100});route=[];stuckAt=Date.now();previous=s.player.feet;
    }else if(!previous||distance(previous,s.player.feet)>=8){previous=s.player.feet;stuckAt=Date.now();}
    await combatTick(s,waypoint);
  }
  throw new Error('Walked route timed out at '+(entity.targetname??target));
}
const entity=predicate=>{const found=entities.find(predicate);assert(found,'Authored interaction entity exists');return found;};
async function interactUntil(target,pattern,predicate,label){
  await walkTo(target,pattern);await movement();await aim(false);
  for(let attempt=0;attempt<6;attempt++){
    const before=await monitor();if(predicate(before))return before;
    assert(pattern.test(before.prompt),'Expected '+label+' prompt, got '+before.prompt);
    await page.keyboard.press('KeyF');await page.waitForTimeout(100);
    let s=await monitor();
    while(s.drinking){await combatTick(s);s=await monitor();}
    if(predicate(s)){await milestone(label);return s;}
    await combatTick(s);
  }
  throw new Error('Ordinary interaction did not complete: '+label);
}
async function farmUntil(points,wall){
  await walkTo(wall,/M14|MP40/);await movement();let boughtAmmoAt=-100;
  while(true){
    const s=await monitor();
    const reserveThreshold=s.weapon.id==='mp40_zm'?32:16,ammoPrice=s.weapon.id==='mp40_zm'?500:250;
    if(s.weapon.reserve<reserveThreshold&&s.points>=ammoPrice&&s.time-boughtAmmoAt>1){
      if(!/ammo/.test(s.prompt)){await walkTo(wall,/ammo/);continue;}
      await page.keyboard.press('KeyF');await page.waitForTimeout(60);boughtAmmoAt=s.time;
      const after=await monitor();assert(after.weapon.reserve>s.weapon.reserve,'Wall ammo purchase replenished reserve');
      events.push({event:'Bought earned wall ammunition',time:s.time,weapon:s.weapon.id,price:ammoPrice,pointsBefore:s.points,pointsAfter:after.points,reserveBefore:s.weapon.reserve,reserveAfter:after.weapon.reserve});continue;
    }
    if(s.points>=points)return s;
    await combatTick(s);
  }
}

let finalState=null,failure=null;
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});
  // Guard this harness against accidental shortcuts, with a per-method audit.
  await page.evaluate(()=>{
    const allowed=new Set(['getState','getEntities','navigationPath','lookAt','aimAtEnemy','lastShot','specialState','completionState','audioState','memoryState','weaponVisual']);
    globalThis.normalProgressionAudit={calls:{},forbiddenAttempts:[]};
    for(const [name,fn] of Object.entries(kino.debug))if(typeof fn==='function')kino.debug[name]=(...args)=>{
      normalProgressionAudit.calls[name]=(normalProgressionAudit.calls[name]??0)+1;
      if(!allowed.has(name)){normalProgressionAudit.forbiddenAttempts.push(name);throw new Error('Forbidden progression shortcut: '+name);}
      return fn(...args);
    };
  });
  entities=await page.evaluate(()=>kino.debug.getEntities());
  await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);startedAt=Date.now();deadline=startedAt+budget;
  const m14=entity(e=>e.zombie_weapon_upgrade==='m14_zm'),mp40=entity(e=>e.zombie_weapon_upgrade==='mp40_zm');
  await interactUntil(m14,/M14/,s=>s.weapon.id==='m14_zm','Bought M14 after walking from spawn');
  await farmUntil(750,m14);
  await interactUntil(entity(e=>e.script_noteworthy==='specialty_quickrevive'),/Quick Revive/,s=>s.perks.includes('specialty_quickrevive'),'Bought earned Quick Revive');
  await farmUntil(3000,m14);
  for(const name of ['foyer_top_door','vip_top_door'])await interactUntil(entity(e=>e.target===name&&e.targetname==='zombie_door'),/Open door/,s=>s.openDoors.includes(name),'Bought '+name);
  await interactUntil(mp40,/MP40/,s=>s.weapon.id==='mp40_zm','Bought earned MP40');
  await farmUntil(5250,mp40);
  for(const name of ['dining_room_door','dress_door'])await interactUntil(entity(e=>e.target===name&&e.targetname==='zombie_door'),/Open door/,s=>s.openDoors.includes(name),'Bought '+name);
  await interactUntil(entity(e=>e.targetname==='use_elec_switch'),/Turn on the power/,s=>s.power,'Restored power through purchased route');
  await interactUntil(entity(e=>e.script_noteworthy==='specialty_armorvest'),/Juggernog/,s=>s.perks.includes('specialty_armorvest'),'Bought earned Juggernog');
  await farmUntil(5500,mp40);
  const stage=entity(e=>e.targetname==='trigger_teleport_pad_0'),lobby=entity(e=>e.targetname==='pf16_auto1');
  await interactUntil(stage,/Initiate teleporter link/,s=>s.teleporter==='linking','Started stage teleporter link');
  await interactUntil(lobby,/Link with the mainframe/,s=>s.teleporter==='linked','Walked to and linked lobby pad');
  // A use prompt is reachable from beside the pad. Walk onto its center so
  // the authored contact volume remains occupied during the departure delay.
  await walkTo(stage);await movement();await aim(false);
  const onPad=await monitor();assert(stage.bounds.every((bound,i)=>bound.every((value,axis)=>i?onPad.player.feet[axis]<=value:onPad.player.feet[axis]>=value)),'Walked fully inside the departure pad');
  await page.keyboard.press('KeyF');
  const departure=Date.now();let boarding=await monitor();
  while(boarding.player.feet[1]<300){assert(Date.now()-departure<8000,'Stayed on linked pad until departure');await combatTick(boarding);boarding=await monitor();}
  await milestone('Reached projection room using earned gameplay teleporter');
  const machine=entity(e=>e.targetname==='zombie_vending_upgrade');
  await interactUntil(machine,/Pack-a-Punch/,s=>!!s.pack,'Paid 5000 earned points for Pack-a-Punch');
  while(!(await monitor()).pack?.ready){await movement();await page.waitForTimeout(100);}
  await interactUntil(machine,/Take /,s=>!!s.weapon.upgraded,'Claimed earned upgraded MP40');
  finalState=await monitor();assert(finalState.power);assert(finalState.perks.includes('specialty_armorvest'));assert(finalState.weapon.upgraded);assert.equal(finalState.weapon.id,'mp40_zm');
  assert(events.some(e=>e.event==='Bought earned Quick Revive'));assert.equal(errors.length,0,errors.join('\n'));
  const audit=await page.evaluate(()=>normalProgressionAudit);assert.deepEqual(audit.forbiddenAttempts,[]);
  await page.keyboard.press('Escape');
}catch(error){failure={message:String(error),stack:error.stack};process.exitCode=1;console.error(error);finalState=await state().catch(()=>null);await page.screenshot({path:path.join(attempt,'failure.png')}).catch(()=>{});}
finally{
  await movement().catch(()=>{});await aim(false).catch(()=>{});
  const report={passed:!failure,method:'Normal live enemies, damage, economy and collision; keyboard/mouse purchases and walked routes. Automatic head targeting and read-only navigation queries. No debug currency, weapons, perks, spawning, damage, invulnerability, position edits, resets, round changes or time acceleration. Projection-room travel uses the earned in-game teleporter.',attempt,wallSeconds:startedAt?(Date.now()-startedAt)/1000:0,events,trace,final:finalState,error:failure,errors,audit:await page.evaluate(()=>globalThis.normalProgressionAudit??null).catch(()=>null)};
  fs.writeFileSync(path.join(attempt,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({finished:true,passed:report.passed,attempt,wallSeconds:report.wallSeconds,time:finalState?.time,round:finalState?.round,kills:finalState?.kills,error:failure?.message}));
  await browser.close();
}
