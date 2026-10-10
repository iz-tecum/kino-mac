import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';
const out='artifacts/v3-weapons',data=JSON.parse(fs.readFileSync('export/web/game-data.json'));
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
try{
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
  for(const [id,upgraded] of [['cz75dw_zm',false],['cz75dw_zm',true],['m1911_zm',true],['pm63_zm',true],['hs10_zm',true]]){
    const def=upgraded?{...data.weapons[id],...data.weapons[id].upgrade}:data.weapons[id];
    await page.evaluate(id=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.giveWeapon(id);},id);await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await page.evaluate(()=>kino.debug.step(2));
    if(upgraded){await page.evaluate(()=>{const ents=kino.debug.getEntities();kino.debug.grantPoints(5000);kino.debug.teleportPlayer(ents.find(e=>e.targetname==='use_elec_switch').position);kino.debug.interact();kino.debug.teleportPlayer(ents.find(e=>e.targetname==='zombie_vending_upgrade').position);if(!kino.debug.interact())throw Error('PAP purchase failed');kino.debug.step(4.5);if(!kino.debug.interact())throw Error('PAP claim failed');});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await page.evaluate(()=>kino.debug.step(2));}
    const shots=await page.evaluate(({clipSize,fireTime})=>{const shots=[];kino.debug.teleportPlayer([0,100,1120]);kino.debug.lookAt([0,500,1200]);for(let i=0;i<clipSize;i++){if(!kino.debug.shoot())throw Error('shot blocked at '+i);shots.push({mag:kino.debug.getState().weapon.mag,animation:kino.debug.weaponVisual().animation});kino.debug.step(fireTime+.02);}return shots;},{clipSize:def.clipSize,fireTime:def.fireTime});
    assert.deepEqual(shots.slice(-2).map(s=>s.mag),[1,0]);assert.equal(shots.at(-2).animation,'leftLastShotAnim');assert.equal(shots.at(-1).animation,'lastShotAnim');
    assert(!shots.slice(0,-2).some(s=>s.animation==='leftLastShotAnim'||s.animation==='lastShotAnim'));
    checks.push({id,upgraded,passed:true,shots});console.log('PASS',id,upgraded?'upgraded':'base');
  }
  assert.equal(errors.length,0,errors.join('\n'));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/dual-last-shot-report.json`,JSON.stringify({method:'Actual gameplay fire calls, debug-assisted upgrades and controlled time; both aggregate final shots empty their own paired magazine.',checks,errors},null,2));await browser.close();}
