import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_DESKTOP_DIR||'artifacts/desktop-settings';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
const state=()=>page.evaluate(()=>kino.debug.getState());
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
async function setting(key,value){const el=page.locator(`[data-setting="${key}"]`);await el.evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function start(){await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);}
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});
 await page.click('#settings-open');await page.screenshot({path:out+'/01-settings.png'});
 await setting('sensitivity',1.35);await setting('fov',92);await setting('master',25);await setting('music',10);await setting('profile','reimagined');await setting('quality','performance');
 await page.click('#settings-done');await start();await page.waitForTimeout(600);
 let s=await state(),audio=await page.evaluate(()=>kino.debug.audioState());
 assert.equal(s.profile,'reimagined');assert.equal(s.settings.sensitivity,1.35);assert(Math.abs(s.cameraFov-92)<.1);assert.equal(s.renderScale,1);assert.equal(audio.mix.master,25);assert.equal(audio.mix.music,10);
 pass('Settings affect actual camera, rendering resolution, mix, and new-run profile',{fov:s.cameraFov,scale:s.renderScale,mix:audio.mix,profile:s.profile});
 await page.keyboard.down('KeyW');await page.mouse.down();await page.waitForTimeout(150);await page.keyboard.press('Escape');await page.keyboard.up('KeyW');await page.mouse.up();await page.waitForTimeout(200);
 const paused=await state();await page.waitForTimeout(400);s=await state();assert.equal(s.time,paused.time);assert.deepEqual(s.player.feet,paused.player.feet);assert.equal(s.weapon.mag,paused.weapon.mag);assert(!s.input.primary&&!s.input.ads);assert.equal((await page.evaluate(()=>kino.debug.audioState())).state,'suspended');
 pass('Pause clears held input and freezes movement, ammunition, simulation, and audio');
 await page.click('#settings-open');await setting('profile','classic');await page.click('#settings-done');await start();assert.equal((await state()).profile,'reimagined');pass('Changing next-run profile cannot change an active run');
 await page.keyboard.press('Escape');await page.click('#restart');await page.waitForFunction(()=>kino.debug.getState().active);s=await state();assert.equal(s.profile,'classic');assert.equal(s.health,100);assert.equal(s.points,500);assert.equal(s.weapon.mag,8);assert.equal(s.perks.length,0);pass('Restart applies pending profile and restores a clean run without firing menu clicks');
 await page.keyboard.press('Escape');await page.reload();await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});s=await state();assert.equal(s.settings.fov,92);assert.equal(s.settings.master,25);assert.equal(s.settings.profile,'classic');pass('Settings persist through renderer reload');
 await start();await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);});
 const measurements=[];
 for(let run=0;run<4;run++){
  await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.setRound(25);const p=kino.debug.getState().player.feet;for(let i=0;i<24;i++)kino.debug.spawnEnemy([p[0]+Math.cos(i)*130,p[1],p[2]+Math.sin(i)*130],i%7===0?'nova':'zombie');});
  await page.waitForTimeout(1200);let sample=await page.evaluate(()=>({state:kino.debug.getState(),memory:kino.debug.memoryState(),audio:kino.debug.audioState()}));
  assert.equal(sample.state.enemies.length,24);assert(sample.audio.voices<=sample.audio.maxVoices);measurements.push({run,geometries:sample.memory.geometries,textures:sample.memory.textures,voices:sample.audio.voices,enemies:sample.state.enemies.length});
  await page.evaluate(()=>{kino.debug.clearEnemies();kino.debug.step(5);});
 }
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);});await page.waitForTimeout(300);
 s=await state();assert.equal(s.enemies.length,0);assert.equal(s.round,1);assert.equal(s.openDoors.length,0);assert.equal(s.power,false);assert.equal(s.effects.fire_sale,undefined);
 assert(measurements.at(-1).geometries<=measurements[1].geometries+4);assert(measurements.at(-1).textures<=measurements[1].textures+4);
 pass('Repeated controlled 24-enemy scenarios and restarts keep resources bounded',measurements);
 await page.screenshot({path:out+'/02-clean-restart.png'});assert.equal(errors.length,0,errors.join('\n'));
}catch(e){checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack});console.error(e);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});process.exitCode=1;}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({checks,errors,state:await state().catch(()=>null)},null,2));await browser.close();}
