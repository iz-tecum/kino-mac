import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';

const out=process.env.KINO_LAPTOP_SETTINGS_OUT??'artifacts/laptop-settings';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const context=await browser.newContext({viewport:{width:1728,height:1117},deviceScaleFactor:2});
await context.addInitScript(()=>{if(!localStorage.getItem('kino.desktop.settings.v1'))localStorage.setItem('kino.desktop.settings.v1',JSON.stringify({version:1,quality:'balanced',fov:89,sensitivity:1.35,master:43,music:22}));});
const page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const state=()=>page.evaluate(()=>kino.debug.getState());
const picture=()=>page.evaluate(()=>{const c=document.querySelector('body>canvas');return{width:c.width,height:c.height,pixels:c.width*c.height,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,scale:kino.debug.getState().renderScale};});
const ready=()=>page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:180000});
const select=async(key,value)=>{await page.selectOption(`[data-setting="${key}"]`,String(value));await page.waitForTimeout(120);};
const snap=name=>page.screenshot({path:`${out}/${name}.png`});
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await ready();
  let s=await state(),p=await picture();assert.equal(s.settings.quality,'balanced');assert.equal(s.settings.fov,89);assert.equal(s.settings.master,43);assert.equal(s.settings.sensitivity,1.35);assert.equal(s.settings.textSize,100);assert.equal(p.dpr,2);assert(p.pixels<=2100000&&p.pixels>2000000);
  pass('Existing choices survive migration; a Retina-sized Balanced canvas obeys its automatic pixel limit',{settings:s.settings,picture:p});
  await page.click('#settings-open');await select('quality','quality');p=await picture();assert(p.pixels>2900000&&p.pixels<=3750000);assert.equal((await state()).settings.quality,'quality');
  pass('An explicit sharper-picture choice is respected instead of silently changing the selected preset',p);
  await select('quality','laptop');p=await picture();assert(p.pixels<=1250000&&p.pixels>1200000);
  const effects=await page.evaluate(()=>({textures:kino.debug.textureDetailState(),actors:kino.debug.actorRenderingState(),daylight:kino.debug.lightingState().daylight}));
  assert.equal(effects.textures.quality,'performance');assert.equal(effects.actors.quality,'performance');assert.equal(effects.daylight.visible,false);
  pass('Laptop lowers actual canvas work and selects the existing lower-cost scene effects',{picture:p,effects});
  await page.setViewportSize({width:2560,height:1440});await page.waitForTimeout(300);p=await picture();assert(p.pixels<=1250000&&p.pixels>1200000);assert(p.scale<.6);assert.equal((await state()).settings.quality,'laptop');
  await page.setViewportSize({width:1280,height:800});await page.waitForTimeout(300);p=await picture();assert.equal(p.scale,1);assert.equal(p.pixels,1024000);
  pass('Resizing recomputes resolution in both directions while retaining Laptop',p);
  await page.click('#settings-comfort');s=await state();assert.equal(s.settings.reducedFlashes,true);assert.equal(s.settings.weaponBob,false);assert.equal(s.settings.textSize,120);assert.equal(s.settings.fov,89);assert.equal(s.settings.master,43);assert.equal(s.settings.quality,'laptop');
  const text=await page.evaluate(()=>({scale:getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),label:parseFloat(getComputedStyle(document.querySelector('.settings-columns label')).fontSize),objective:parseFloat(getComputedStyle(document.getElementById('objective')).fontSize)}));
  assert.equal(text.scale,'1.2');assert(text.label>=16.8-1e-4);assert(text.objective>=14.4-1e-4);await snap('01-comfort-1280');
  pass('Comfort changes only flashes, walking bob and readable native-resolution text',{settings:s.settings,text});
  await select('textSize',140);await select('crouchMode','toggle');await select('sprintMode','toggle');await page.uncheck('[data-setting="wheelSwitch"]');
  await page.setViewportSize({width:390,height:640});await page.waitForTimeout(250);await page.locator('#settings-close').focus();
  const layout=await page.locator('#settings-panel').evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
  assert(layout.scrollWidth<=layout.clientWidth+1);assert(layout.scrollHeight>layout.clientHeight);await snap('02-larger-text-narrow');
  await page.locator('#settings-done').focus();const r=await page.locator('#settings-done').boundingBox();assert(r.y>=0&&r.y+r.height<=640);await snap('03-larger-text-narrow-bottom');
  await page.keyboard.press('Enter');assert(await page.locator('#settings-panel').isHidden());assert.equal(await page.evaluate(()=>document.activeElement.id),'settings-open');
  pass('Larger text at 390×640 scrolls vertically without horizontal clipping and Done remains keyboard reachable',layout);
  await page.setViewportSize({width:1280,height:800});await page.reload();await ready();s=await state();for(const [key,value]of Object.entries({quality:'laptop',textSize:140,crouchMode:'toggle',sprintMode:'toggle',wheelSwitch:false,reducedFlashes:true,weaponBob:false,fov:89,master:43}))assert.equal(s.settings[key],value,key);
  await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);});await page.waitForTimeout(250);await snap('04-larger-hud');await page.keyboard.press('Escape');await page.waitForFunction(()=>!kino.debug.getState().active);
  pass('Laptop, comfort and input choices persist on reload and play/pause still works',{settings:(await state()).settings,picture:await picture()});
  await page.click('#settings-open');await page.click('#settings-defaults');s=await state();assert.equal(s.settings.quality,'balanced');assert.equal(s.settings.textSize,100);assert.equal(s.settings.reducedFlashes,false);assert.equal(s.settings.weaponBob,true);assert.equal(s.settings.crouchMode,'hold');assert.equal(s.settings.sprintMode,'hold');assert.equal(s.settings.wheelSwitch,true);
  await page.keyboard.press('Escape');assert(!(await state()).active);assert.equal(errors.length,0,errors.join('\n'));
  pass('Restore defaults resets new controls together and settings Escape leaves gameplay paused; zero browser errors');
}catch(error){checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;await snap('failure').catch(()=>{});}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({scope:'Actual Chrome WebGL and native DOM interaction with deviceScaleFactor=2 and varied CSS viewports on the current Mac. No physical MacBook, energy-use, screen-reader or FPS claim.',checks,errors,state:await state().catch(()=>null)},null,2));await browser.close();}
