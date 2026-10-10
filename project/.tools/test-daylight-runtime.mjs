import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_DAYLIGHT_OUT??'artifacts/v4-final/daylight';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
let page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const checks=[],errors=[],expectedFailureEvents=[],restartSamples=[];let probingMissing=false;
const watch=page=>{page.on('pageerror',e=>(probingMissing?expectedFailureEvents:errors).push({kind:'script',message:String(e)}));page.on('console',m=>{if(m.type()==='error')(probingMissing?expectedFailureEvents:errors).push({kind:'console',message:m.text()});});page.on('response',r=>{if(r.status()>=400)(probingMissing?expectedFailureEvents:errors).push({kind:'http',status:r.status(),url:r.url()});});};watch(page);
const read=()=>page.evaluate(()=>({game:kino.debug.getState(),light:kino.debug.lightingState(),memory:kino.debug.memoryState()}));
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const loaded=()=>page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});
async function quality(value){await page.locator('[data-setting="quality"]').selectOption(value);await page.waitForTimeout(100);}
async function pause(){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement&&!kino.debug.getState().active);}
async function start(){await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);await page.evaluate(()=>kino.debug.setAutoSpawn(false));await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await page.waitForTimeout(250);}
try{
 await page.goto('http://127.0.0.1:5173/');await loaded();await start();let s=await read();
 assert.equal(s.light.daylight.shafts,9);assert.equal(s.light.daylight.dust,198);assert(s.light.daylight.skyMeshes>0);assert(s.light.daylight.visible);pass('Final daylight loads nine shafts,198 dust particles and native sky meshes',s.light.daylight);
 await page.screenshot({path:out+'/01-daylight-lobby.png'});
 await pause();const paused=await read();await page.waitForTimeout(450);const later=await read();assert.equal(later.game.time,paused.game.time);assert.deepEqual(later.game.player.feet,paused.game.player.feet);assert.deepEqual(later.light.daylight,paused.light.daylight);pass('Real Escape freezes simulation and preserves daylight state',{time:paused.game.time,daylight:paused.light.daylight});
 await page.click('#settings-open');await quality('performance');s=await read();assert.equal(s.game.settings.quality,'performance');assert(!s.light.daylight.visible);assert.equal(s.game.renderScale,1);
 await quality('balanced');s=await read();assert.equal(s.game.settings.quality,'balanced');assert(s.light.daylight.visible);assert.equal(s.game.renderScale,1.25);await page.click('#settings-done');await start();pass('Performance disables shafts and dust; Balanced restores them with matching render scale',s.light.daylight);
 // First reset can expose previously unrendered geometry. Record that cold
 // transition separately, then require three exact, stable measured cycles.
 await page.waitForTimeout(700);const initial=await read();let baseline=initial;restartSamples.push({phase:'before-warmup',memory:initial.memory,daylight:initial.light.daylight});
 for(let cycle=0;cycle<=3;cycle++){
   await pause();await page.click('#restart');await page.waitForFunction(()=>kino.debug.getState().active&&kino.debug.getState().viewmodelReady);await page.evaluate(()=>kino.debug.setAutoSpawn(false));await page.waitForTimeout(450);s=await read();
   assert.equal(s.game.round,1);assert.equal(s.game.points,500);assert.equal(s.game.power,false);assert.equal(s.game.enemies.length,0);assert.deepEqual(s.light.daylight,baseline.light.daylight);
   restartSamples.push({phase:cycle===0?'warmup':'measured',cycle,memory:s.memory,daylight:s.light.daylight});
   assert.equal(s.memory.geometryBytes,initial.memory.geometryBytes,'Scene geometry bytes do not grow, including the first restart');assert.equal(s.memory.textureBytes,initial.memory.textureBytes,'Scene texture bytes do not grow');
   if(cycle===0)baseline=s;else{assert.equal(s.memory.geometries,baseline.memory.geometries);assert.equal(s.memory.textures,baseline.memory.textures);}
 }
 pass('Three measured menu restarts after warmup retain identical GPU counts and scene bytes',restartSamples);await page.screenshot({path:out+'/02-third-restart.png'});
 await page.close();page=await browser.newPage({viewport:{width:1100,height:760}});watch(page);probingMissing=true;
 await page.route('**/theater-daylight.json',route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"intentional missing daylight fixture"}'}));
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>document.querySelector('#load-label')?.textContent.includes('Unable to start'),null,{timeout:120000});
 const failure=await page.evaluate(()=>({ready:kino.debug.getState().ready,label:document.querySelector('#load-label').textContent,status:document.querySelector('#menu-status').textContent,button:document.querySelector('#start').textContent,disabled:document.querySelector('#start').disabled}));
 assert(!failure.ready);assert.match(failure.label,/Theater daylight data: 404/);assert.equal(failure.button,'RETRY LOADING');assert(!failure.disabled);assert(expectedFailureEvents.some(e=>e.kind==='http'&&e.status===404&&e.url.endsWith('theater-daylight.json')));assert(expectedFailureEvents.every(e=>e.kind==='http'?e.status===404&&e.url.endsWith('theater-daylight.json'):/404/.test(e.message)),JSON.stringify(expectedFailureEvents));await page.screenshot({path:out+'/03-missing-plan-recovery.png'});pass('Missing daylight plan produces an explicit retryable loading error',failure);
 await page.unroute('**/theater-daylight.json');probingMissing=false;await page.click('#start');await loaded();s=await read();assert.equal(s.light.daylight.shafts,9);assert.equal(s.light.daylight.dust,198);assert(s.light.daylight.skyMeshes>0);pass('Retry succeeds after the required daylight file is restored',s.light.daylight);
 assert.equal(errors.length,0,JSON.stringify(errors));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack,state:await read().catch(()=>null)});console.error(error);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Actual browser with real pause/settings/restart controls, normal map initialization, exact renderer resource counts, and one deliberately failed daylight request followed by real Retry. Controlled smoke, not a performance benchmark.',checks,errors,expectedFailureEvents,restartSamples},null,2));await browser.close();}
