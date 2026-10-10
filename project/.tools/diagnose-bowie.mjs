import {chromium} from 'playwright-core';
import fs from 'node:fs';import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v5-combat/melee-diagnosis';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}}),cases=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
 for(const dogRound of [true,false]){
  const tries=await page.evaluate(wanted=>{for(let n=0;n<40;n++){kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.setRound(10);if(kino.debug.getState().dogRound===wanted)return n+1;}throw Error('Could not sample round schedule');},dogRound);
  await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
  const purchased=await page.evaluate(()=>{kino.debug.step(2);kino.debug.grantPoints(3000);const e=kino.debug.getEntities().find(e=>e.targetname==='bowie_upgrade');kino.debug.teleportPlayer(e.position);kino.debug.step(.2);kino.debug.interact();return kino.debug.getState().bowie;});assert(purchased);
  for(const kind of [undefined,'zombie']){
   const result=await page.evaluate(kind=>{
    kino.debug.teleportPlayer([0,100,1120]);kino.debug.step(2);const p=kino.debug.getState().player.feet,id=kino.debug.spawnEnemy([p[0],p[1],p[2]-60],kind);kino.debug.step(.08);kino.debug.aimAtEnemy(id,false);
    const before=kino.debug.getState(),started=kino.debug.melee();kino.debug.step(.17);const after=kino.debug.getState(),visual=kino.debug.weaponVisual();kino.debug.clearEnemies();return {kind:kind??'default',id,started,before,after,visual};
   },kind);cases.push({wantedDogRound:dogRound,tries,...result});assert(result.started);const target=result.before.enemies.find(z=>z.id===result.id),survivor=result.after.enemies.find(z=>z.id===result.id);
   if(dogRound&&kind===undefined){assert.equal(target.kind,'dog');assert.equal(target.health,900);assert(!survivor);}
   else{assert.equal(target.kind,'zombie');assert.equal(target.health,1045);assert.equal(survivor.health,45);}
   console.log('PASS',dogRound?'dog round':'normal round',kind??'default',target.kind,target.health,'→',survivor?.health??'dead');
  }
 }
 assert.equal(errors.length,0,errors.join('\n'));
}catch(error){cases.push({passed:false,error:String(error),state:await page.evaluate(()=>kino.debug.getState()).catch(()=>null)});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/round-species-report.json`,JSON.stringify({method:'Actual game with unmodified random schedule, sampled until round 10 is a dog round or ordinary round; explicit target species compared against the legacy default spawn fixture. Debug currency/position/time/invulnerability are controlled setup.',cases,errors},null,2));await browser.close();}
