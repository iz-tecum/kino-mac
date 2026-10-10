import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v6-controller';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
let page=await browser.newPage({viewport:{width:1440,height:900}});const checks=[],errors=[];
const monitor=p=>{p.on('pageerror',e=>errors.push(String(e)));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});};monitor(page);
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:180000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.step(.5);});
 const stance=await page.evaluate(()=>{
  const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),d=kino.debug;
  const standing=structuredClone(d.getState().player);key('keydown','KeyC');d.step(1/60);const transition=structuredClone(d.getState().player);d.step(.5);const crouched=structuredClone(d.getState().player);key('keyup','KeyC');d.step(.5);const restored=structuredClone(d.getState().player);
  return {standing,transition,crouched,restored};
 });
 assert(stance.standing.view.smoothing);assert(stance.transition.crouched);assert(stance.transition.view.eyeHeight>40&&stance.transition.view.eyeHeight<60);assert(Math.abs(stance.crouched.view.eyeHeight-40)<.01);assert(!stance.restored.crouched);assert(Math.abs(stance.restored.view.eyeHeight-60)<.01);pass('actual Kino crouch and stand ease while physical stance changes immediately',stance);
 const pause=await page.evaluate(()=>{
  const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),d=kino.debug;
  d.teleportPlayer([-488,0,-1246]);d.step(.5);d.lookAt([-488,44,-1446]);key('keydown','KeyW');d.step(.2);const moving=structuredClone(d.getState().player);d.pause();const before=structuredClone(d.getState().player);key('keyup','KeyW');d.resume();d.step(.3);const after=structuredClone(d.getState().player);return {moving,before,after};
 });
 fs.writeFileSync(`${out}/pause-probe.json`,JSON.stringify(pause,null,2));assert(Math.abs(pause.moving.velocity.z)+Math.abs(pause.moving.velocity.x)>100);assert(Math.hypot(pause.after.feet[0]-pause.before.feet[0],pause.after.feet[2]-pause.before.feet[2])<.001);pass('real pause/resume does not replay held movement or horizontal momentum',pause);
 const route=await page.evaluate(()=>{
  const d=kino.debug,key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));const door=d.getEntities().find(e=>e.target==='foyer_top_door'&&e.targetname==='zombie_door');d.grantPoints(1000);d.teleportPlayer(door.position);d.step(.15);if(!d.interact())throw new Error('Controlled route door setup failed');d.teleportPlayer([-115,100,1254]);d.step(.5);
  const path=d.navigationPath(structuredClone(d.getState().player).feet,[582,340,641]),samples=[];let failed=null;
  for(const waypoint of path.slice(1)){
   let reached=false;key('keydown','KeyW');
   for(let i=0;i<600;i++){
    const p=structuredClone(d.getState().player);if(Math.hypot(p.feet[0]-waypoint[0],p.feet[2]-waypoint[2])<12){reached=true;break;}
    d.lookAt([waypoint[0],p.position[1],waypoint[2]]);d.step(1/60);const s=structuredClone(d.getState().player);samples.push({feet:s.feet,eye:s.position,stepOffset:s.view.stepOffset,grounded:s.grounded});
   }
   key('keyup','KeyW');if(!reached){failed={waypoint,player:structuredClone(d.getState().player)};break;}
  }
  d.step(.3);return {path,failed,final:structuredClone(d.getState().player),samples};
 });
 fs.writeFileSync(`${out}/route-probe.json`,JSON.stringify(route,null,2));assert.equal(route.failed,null,JSON.stringify(route.failed));assert(route.samples.length>100);assert(route.final.feet[1]>300);pass('actual W input walks the complete lobby staircase without mid-route teleporting',route);await page.screenshot({path:`${out}/01-upper-stairs.png`});
 const jump=await page.evaluate(()=>{
  const d=kino.debug,key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));d.teleportPlayer([-488,0,-1246]);d.step(.5);const before=structuredClone(d.getState().player);key('keydown','Space');d.step(.1);key('keyup','Space');const rising=structuredClone(d.getState().player);d.pause();const paused=structuredClone(d.getState().player);d.resume();d.step(.1);const resumed=structuredClone(d.getState().player);d.step(1);return {before,rising,paused,resumed,landed:structuredClone(d.getState().player)};
 });
 assert(jump.rising.velocity.y>0);assert.equal(jump.paused.velocity.y,jump.rising.velocity.y);assert(jump.resumed.velocity.y<jump.paused.velocity.y);assert(jump.landed.grounded);assert(Math.abs(jump.landed.feet[1]-jump.before.feet[1])<.2);pass('pause preserves a real jump vertical velocity and normal landing',jump);
 const teleport=await page.evaluate(()=>{
  const d=kino.debug;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyC',bubbles:true}));d.step(.1);d.teleportPlayer([582,340,641]);const state=structuredClone(d.getState().player);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyC',bubbles:true}));return state;
 });assert(!teleport.crouched);assert.equal(teleport.position[1],teleport.feet[1]+60);pass('crouched teleport immediately resets the rendered eye to the standing destination',teleport);
 await page.close();page=await browser.newPage({viewport:{width:1440,height:900}});monitor(page);
 await page.goto('http://127.0.0.1:5173/moon.html?mode=explore',{timeout:180000});await page.waitForFunction(()=>window.moon?.ready||document.querySelector('#error')?.textContent,null,{timeout:180000});assert(await page.evaluate(()=>Boolean(window.moon?.ready)),await page.locator('#error').textContent());await page.click('#start');await page.waitForFunction(()=>moon.debug.snapshot().active);await page.waitForTimeout(500);
 const moonStart=await page.evaluate(()=>({state:moon.debug.snapshot(),smooth:moon.player.smoothCamera}));assert(!moonStart.smooth);assert(moonStart.state.grounded);
 await page.keyboard.down('KeyS');await page.waitForTimeout(600);await page.keyboard.up('KeyS');const moved=await page.evaluate(()=>moon.debug.snapshot());assert(Math.hypot(moved.position[0]-moonStart.state.position[0],moved.position[2]-moonStart.state.position[2])>20);
 await page.screenshot({path:`${out}/02-moon-default-controller.png`});
 const moonReset=await page.evaluate(()=>{
  const p=moon.player;p.setInput({crouch:true,jump:true});p.step(.01);const target=p.camera.position.clone();target.y=80;p.reset(target,{eye:true,resolve:false});return {eye:p.camera.position.toArray(),crouched:p.crouched,input:{...p.input},smooth:p.smoothCamera};
 });assert.equal(moonReset.eye[1],80);assert(!moonReset.crouched);assert(!moonReset.input.jump);pass('preserved Moon uses unsmoothed controller, native spawn/movement and corrected eye reset',{moonStart,moved,moonReset});
 assert.equal(errors.length,0,errors.join('\n'));pass('zero script, shader, or missing-asset errors');
}catch(e){checks.push({name:'runtime failure',passed:false,error:String(e),stack:e.stack});console.error(e);process.exitCode=1;await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}
finally{fs.writeFileSync(`${out}/runtime-report.json`,JSON.stringify({method:'Controlled real game keyboard paths with debug setup and deterministic simulation steps; Moon uses wall-clock input. This verifies controller behavior, not survival or performance.',checks,errors},null,2));await browser.close();}
