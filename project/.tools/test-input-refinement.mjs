import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_INPUT_OUT??'artifacts/v6-input';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const state=()=>page.evaluate(()=>kino.debug.getState());
const ready=()=>page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
const key=(type,code)=>page.evaluate(({type,code})=>dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),{type,code});
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
 await page.evaluate(()=>{kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.step(1);kino.debug.shoot();kino.debug.reload();kino.debug.step(.2);});
 await key('keydown','KeyQ');await key('keyup','KeyQ');let s=await state();assert(s.reloadLeft>0);assert.equal(s.weapon.id,'m1911_zm');
 pass('Q aim toggle leaves the active reload and held weapon intact',{reloadLeft:s.reloadLeft});
 await page.waitForFunction(()=>{const p=Number(document.getElementById('reload-progress-fill').style.transform.match(/scaleX\(([^)]+)\)/)?.[1]);return kino.debug.getState().reloadLeft>0&&!document.getElementById('reload-progress').hidden&&p>0&&p<1;});
 // Read the cue and authoritative timer together. Encoding a screenshot can
 // outlast a short reload under build/test load and must not time this check.
 const reloadCue=await page.evaluate(()=>({left:kino.debug.getState().reloadLeft,visible:!document.getElementById('reload-progress').hidden,progress:document.getElementById('reload-progress-fill').style.transform}));
 const progress=reloadCue.progress;assert(reloadCue.left>0&&reloadCue.visible);assert(!['scaleX(0)','scaleX(1)'].includes(progress));assert(Number(progress.match(/scaleX\(([^)]+)\)/)?.[1])>0&&Number(progress.match(/scaleX\(([^)]+)\)/)?.[1])<1);
 await page.screenshot({path:out+'/reload-progress.png'});
 await page.evaluate(()=>kino.debug.step(4));assert.equal((await state()).weapon.mag,8);assert(!(await page.locator('#reload-progress').isVisible()));pass('reload progress reflects the real pending transfer and hides on completion',{progress});
 await page.evaluate(()=>kino.debug.giveWeapon('m14_zm'));await ready();await page.evaluate(()=>kino.debug.step(1));
 await page.evaluate(()=>{for(let i=0;i<50;i++)dispatchEvent(new WheelEvent('wheel',{deltaY:12,bubbles:true,cancelable:true}));});
 assert.equal((await state()).weapon.id,'m1911_zm');await ready();await page.waitForTimeout(220);
 await page.evaluate(()=>dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})));assert.equal((await state()).weapon.id,'m14_zm');pass('trackpad gesture with 50 wheel events causes one switch; next gesture switches normally');await ready();
 await page.evaluate(()=>{dispatchEvent(new WheelEvent('wheel',{deltaY:120,ctrlKey:true}));dispatchEvent(new WheelEvent('wheel',{deltaX:150,deltaY:10}));});assert.equal((await state()).weapon.id,'m14_zm');pass('pinch zoom and horizontal scrolling do not switch weapons');
 await page.evaluate(()=>{kino.debug.step(1);kino.debug.shoot();kino.debug.reload();});await key('keydown','Digit2');await key('keyup','Digit2');s=await state();assert(s.reloadLeft>0);await page.keyboard.press('Digit1');assert.equal((await state()).reloadLeft,0);await ready();pass('same-slot key preserves reload; a different slot cancels it cleanly');
 await page.evaluate(()=>kino.debug.step(1));await page.keyboard.down('KeyW');await page.mouse.down();await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('KeyW');
 s=await state();assert(!s.active);assert(!s.input.primary&&!s.input.ads);const feet=s.player.feet,time=s.time,mag=s.weapon.mag;
 await page.waitForTimeout(300);assert.equal((await state()).time,time);
 await page.click('#start');await page.waitForTimeout(220);s=await state();assert.equal(s.weapon.mag,mag);assert(Math.hypot(...s.player.feet.map((v,i)=>v-feet[i]))<2);pass('pause clears held movement/fire and resume cannot leak a menu click into a shot');
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);});await ready();assert.equal((await state()).inventory.length,1);assert.equal((await state()).weapon.mag,8);assert.equal(errors.length,0);pass('restart clears tested input and reload state without browser errors');
}catch(e){checks.push({passed:false,error:String(e),stack:e.stack,state:await state().catch(()=>null)});console.error(e);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({method:'Actual game in isolated Chrome, normal key/mouse transitions and synthetic trackpad event bursts. Debug grants, timing and invulnerability isolate transitions. No physical trackpad or high-refresh display claim.',checks,errors},null,2));await browser.close();}
