// Real-time gameplay automation: no spawned enemies, invulnerability, currency,
// time acceleration, damage injection or player teleportation. Camera targeting
// is automated; this is not a human playthrough.
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_NORMAL_ROUNDS_OUT||'artifacts/normal-rounds';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],events=[];
page.on('pageerror',e=>errors.push(String(e)));
const state=()=>page.evaluate(()=>kino.debug.getState());
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 const target=await page.evaluate(()=>kino.debug.getEntities().find(e=>e.zombie_weapon_upgrade==='m14_zm').position);
 const route=await page.evaluate(target=>kino.debug.navigationPath(kino.debug.getState().player.feet,target),target);assert(route.length>1);
 for(const waypoint of route.slice(1)){
  let reached=false;
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');
  for(let t=0;t<100;t++){
   const s=await state(),p=s.player.feet;if(Math.hypot(p[0]-waypoint[0],p[2]-waypoint[2])<22){reached=true;break;}
   await page.evaluate(w=>{const s=kino.debug.getState();kino.debug.lookAt([w[0],s.player.position[1],w[2]]);},waypoint);await page.waitForTimeout(80);
  }
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');assert(reached,'Walked route waypoint through ordinary collision');
 }
 await page.keyboard.press('KeyF');await page.waitForFunction(()=>kino.debug.getState().weapon.id==='m14_zm');events.push({event:'Bought M14 through walked route',state:await state()});
 const deadline=Date.now()+300000;let lastRound=0;
 while(Date.now()<deadline){
  const s=await state();assert.notEqual(s.phase,'gameover','Survived real enemy attacks');
  if(s.round!==lastRound){lastRound=s.round;events.push({event:'Round '+s.round,time:s.time,kills:s.kills,points:s.points,health:s.health});console.log('ROUND',s.round,'KILLS',s.kills,'POINTS',s.points);await page.screenshot({path:out+'/round-'+s.round+'.png'});}
  if(s.round>=3)break;
  if(s.weapon.mag===0&&!s.reloadLeft){await page.keyboard.press('KeyR');await page.waitForTimeout(100);continue;}
  if(s.weapon.reserve<8&&!s.reloadLeft&&s.points>=250){await page.keyboard.press('KeyF');}
  const target=s.enemies.filter(z=>z.state==='chase'||z.state==='attack'||z.state==='entering').sort((a,b)=>Math.hypot(...a.position.map((v,i)=>v-s.player.feet[i]))-Math.hypot(...b.position.map((v,i)=>v-s.player.feet[i])))[0];
  if(target&&!s.reloadLeft&&s.weapon.mag>0){await page.evaluate(id=>kino.debug.aimAtEnemy(id),target.id);await page.mouse.click(640,400);}
  await page.waitForTimeout(140);
 }
 const s=await state();assert(s.round>=3,'Completed two successive normal rounds');assert(s.kills>=14);assert(s.points>=1000);assert.equal(errors.length,0);await page.keyboard.press('Escape');
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,method:'Real-time normal spawning, damage, economy, inputs and collision; automated camera targeting. No debug grants, invulnerability or simulation acceleration.',events,final:s,errors},null,2));
}catch(e){console.error(e);process.exitCode=1;fs.writeFileSync(out+'/report.json',JSON.stringify({passed:false,error:String(e),events,state:await state().catch(()=>null),errors},null,2));await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await browser.close();}
