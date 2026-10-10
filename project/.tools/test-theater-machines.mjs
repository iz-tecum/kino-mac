import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v8-machines';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),report={method:'Actual browser with debug currency, invulnerability, placement and time advances; real F interactions and actual renderer. Machine prop tests, not walking-route proof.',checks:[],errors:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});page.on('requestfailed',r=>report.errors.push(r.url()));
const check=(name,condition,details)=>{report.checks.push({name,passed:!!condition,details});assert(condition,name)};
async function go(name,feet){await page.evaluate(({name,feet})=>{const e=kino.debug.getEntities().find(e=>e.targetname===name);kino.debug.teleportPlayer(feet??[e.position[0],e.position[1]-55,e.position[2]]);kino.debug.step(.2);kino.debug.lookAt(e.position)},{name,feet});await page.waitForTimeout(80);}
async function pauseShot(name){await page.keyboard.press('Escape');await page.waitForFunction(()=>!kino.debug.getState().active);await page.addStyleTag({content:'#menu,#announcement{visibility:hidden!important}'});await page.screenshot({path:out+'/'+name+'.png'});await page.evaluate(()=>kino.debug.setActive(true));}
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});
 await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true)});
 let m=await page.evaluate(()=>kino.debug.machineState());check('Startup hides powered cable, retains unpowered cable and three native hands',!m.cableOn&&m.cableOff&&m.nativeHands===3&&m.indicator==='off',m);
 await go('use_elec_switch');await page.keyboard.press('KeyF');await page.waitForFunction(()=>kino.debug.getState().power&&kino.debug.machineState().indicator==='red');check('Power keeps unlinked Classic indicator red',await page.evaluate(()=>kino.debug.machineState().indicator==='red'));
 await go('trigger_teleport_pad_0',[-304,0,-1100]);await page.keyboard.press('KeyF');await page.waitForFunction(()=>kino.debug.getState().teleporter==='linking');check('Stage link starts without lighting cable prematurely',await page.evaluate(()=>kino.debug.getState().teleporter==='linking'&&!kino.debug.machineState().cableOn));
 await go('pf16_auto1');await page.keyboard.press('KeyF');await page.waitForTimeout(80);m=await page.evaluate(()=>kino.debug.machineState());check('Confirmed lobby link lights the native cable and stage lamp green',m.cableOn&&!m.cableOff&&m.indicator==='green',m);
 await go('trigger_teleport_pad_0',[-304,0,-1100]);await page.evaluate(()=>kino.debug.lookAt([-275,80,-1047]));await pauseShot('01-linked-stage');
 await page.keyboard.press('KeyF');await page.evaluate(()=>kino.debug.step(2.1));m=await page.evaluate(()=>kino.debug.machineState());check('Projection arrival starts authored countdown and keeps travel cable lit',m.remaining>28&&m.remaining<=30&&m.cableOn&&m.indicator==='red',m);
 await page.evaluate(()=>{kino.debug.teleportPlayer([-90,320,360]);kino.debug.step(.2);kino.debug.lookAt([4,430,505]);});await pauseShot('02-projection-clock');
 await page.evaluate(()=>kino.debug.pause());const before=await page.evaluate(()=>kino.debug.machineState());await page.waitForTimeout(400);check('Paused clock pose freezes',JSON.stringify(before)===JSON.stringify(await page.evaluate(()=>kino.debug.machineState())));
 await page.evaluate(()=>{kino.debug.setActive(true);kino.debug.step(12)});m=await page.evaluate(()=>kino.debug.machineState());check('Second hand advances as actual projection time elapses',m.remaining<18&&m.remaining>14&&Math.abs(m.clockAngles.second-before.clockAngles.second)>.1,m);
 await page.evaluate(()=>{kino.debug.setRoomRandomSequence([0]);kino.debug.step(40)});m=await page.evaluate(()=>kino.debug.machineState());check('Lobby cooldown restores dark cable and red lamp',m.remaining===0&&!m.cableOn&&m.cableOff&&m.indicator==='red',m);
 await page.evaluate(()=>kino.debug.step(91));check('Cooldown ends without leaving powered cable or ready lamp stuck',await page.evaluate(()=>kino.debug.getState().teleporter==='unlinked'&&!kino.debug.machineState().cableOn&&kino.debug.machineState().indicator==='red'));
 const counts=[];for(let i=0;i<4;i++){await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true)});await page.waitForTimeout(120);counts.push(await page.evaluate(()=>({g:kino.debug.memoryState().geometries,t:kino.debug.memoryState().textures,m:kino.debug.machineState()})));}
 check('Repeated resets preserve resources and restore unpowered machine state',counts.slice(1).every(c=>c.g===counts[1].g&&c.t===counts[1].t&&c.m.indicator==='off'&&!c.m.cableOn),counts);
 check('No script, shader or asset errors',!report.errors.length,report.errors);report.success=true;
}catch(e){report.success=false;report.failure=String(e);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
