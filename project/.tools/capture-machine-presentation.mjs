// Visual inspection only: controlled placements and clock time; not route evidence.
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v8-machines/visual';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json'));
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],captures=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
async function use(name){const e=data.entities.find(e=>e.targetname===name&&e.classname==='trigger_use');await page.evaluate(e=>{kino.debug.setActive(true);kino.debug.teleportPlayer(e.position);kino.debug.step(.2);kino.debug.lookAt(e.position);},e);await page.keyboard.press('KeyF');await page.waitForTimeout(100);}
async function shot(name,feet,target){await page.evaluate(({feet,target})=>{kino.debug.setActive(true);kino.debug.teleportPlayer(feet);kino.debug.step(1.2);kino.debug.lookAt(target);}, {feet,target});await page.waitForTimeout(300);await page.evaluate(()=>kino.debug.pause());await page.waitForTimeout(120);captures.push({name,state:await page.evaluate(()=>({player:kino.debug.getState().player,machines:kino.debug.machineState(),map:kino.debug.mapState()}))});await page.screenshot({path:out+'/'+name+'.png'});}
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true)});await page.addStyleTag({content:'#menu,#announcement{visibility:hidden!important}'});
 await use('use_elec_switch');
 await shot('01-stage-unlinked',[-275,0,-950],[-281,64,-1085]);
 await use('trigger_teleport_pad_0');await use('pf16_auto1');
 assert.equal(await page.evaluate(()=>kino.debug.machineState().indicator),'green');
 await shot('02-stage-linked',[-275,0,-950],[-281,64,-1085]);
 await shot('03-native-cable',[-80,-63,-430],[-85,-61,-230]);
 await use('trigger_teleport_pad_0');await page.evaluate(()=>kino.debug.step(2.1));assert(await page.evaluate(()=>kino.debug.mapState().returnAt>0));
 await shot('04-projection-clock',[-90,320,360],[4,423,505]);
 assert(!errors.length);
}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({method:'Debug placement and timing for actual renderer inspection; no screenshot edits. No walking-route claim. Pause/menu/announcement hidden only for captures.',captures,errors},null,2));}
