import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';

const out=process.env.KINO_MENU_OUT??'artifacts/v9-menu';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const snap=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.screenshot({path:path.join(out,name+'.png')});};
const active=()=>page.evaluate(()=>document.activeElement?.id);
async function ready(){
  const until=Date.now()+120000;
  while(Date.now()<until){assert.equal(errors.length,0,errors.join('\n'));if(await page.evaluate(()=>globalThis.kino?.debug.getState().ready))return;await page.waitForTimeout(100);}
  throw new Error('Game did not become ready');
}
async function fitMenu(){
  return page.evaluate(()=>{
    const menu=document.getElementById('menu'),selectors=['#menu-title','#start','#settings-open','.menu-controls','.local-note'];
    if(!document.getElementById('restart').hidden)selectors.push('#restart');
    return {viewport:[innerWidth,innerHeight],scrollWidth:menu.scrollWidth,clientWidth:menu.clientWidth,scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,
      items:selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,width:r.width,height:r.height,inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})};
  });
}
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await ready();
  assert.equal(await page.locator('#menu-title').innerText(),'Kino der Toten');assert.equal(await page.locator('#start').innerText(),'Play');
  assert.equal(await page.getByRole('button',{name:'Settings',exact:true}).count(),1);assert.equal(await page.locator('.menu-side,.tagline,.chapter').count(),0);
  let fit=await fitMenu();assert(fit.items.every(i=>i.inside));assert(fit.scrollWidth<=fit.clientWidth&&fit.scrollHeight<=fit.clientHeight);
  await page.focus('#start');let outline=await page.locator('#start').evaluate(e=>({width:parseFloat(getComputedStyle(e).outlineWidth),style:getComputedStyle(e).outlineStyle}));assert(outline.width>=2&&outline.style!=='none');
  await snap('01-title-1280x800');pass('1280×800 title menu is readable without scrolling, with plain actions and visible keyboard focus',fit);

  await page.keyboard.press('Enter');await page.waitForFunction(()=>kino.debug.getState().active);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!kino.debug.getState().active);
  assert.equal(await page.locator('#start').innerText(),'Resume');assert(await page.locator('#restart').isVisible());
  await page.focus('#start');await page.keyboard.press('Tab');assert.equal(await active(),'restart');await page.keyboard.press('Tab');assert.equal(await active(),'settings-open');
  fit=await fitMenu();assert(fit.items.every(i=>i.inside));await snap('02-pause-1280x800');pass('Keyboard starts and pauses the game; Resume, New game and Settings remain reachable in visual order',fit);

  await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.getElementById('settings-panel').hidden);
  assert.equal(await active(),'settings-close');assert.equal(await page.locator('#settings-panel').getAttribute('role'),'dialog');assert.equal(await page.locator('#settings-panel').getAttribute('aria-modal'),'true');
  await page.keyboard.press('Shift+Tab');assert.equal(await active(),'settings-done');await page.keyboard.press('Tab');assert.equal(await active(),'settings-close');
  const before=await page.evaluate(()=>kino.debug.getState());await page.keyboard.press('Escape');assert(await page.locator('#settings-panel').isHidden());assert.equal(await active(),'settings-open');
  const after=await page.evaluate(()=>kino.debug.getState());assert.equal(after.time,before.time);assert(!after.active);pass('Settings traps keyboard focus, Escape closes only the dialog, and gameplay remains paused');

  await page.setViewportSize({width:1440,height:900});fit=await fitMenu();assert(fit.items.every(i=>i.inside));assert(fit.scrollHeight<=fit.clientHeight);await snap('03-pause-1440x900');pass('1440×900 pause menu retains all essential controls without scrolling',fit);
  await page.click('#settings-open');await snap('04-settings-1440x900');
  const keys=await page.locator('[data-setting]').evaluateAll(items=>items.map(e=>e.dataset.setting));
  for(const key of ['sensitivity','aimSensitivity','fov','invertLook','weaponBob','reducedFlashes','quality','brightness','master','effects','music','ambience','dialogue','profile'])assert(keys.includes(key),key+' retained');
  pass('All pre-existing settings remain available',keys);

  await page.locator('[data-setting="textSize"]').selectOption('140');await page.click('#settings-done');
  await page.setViewportSize({width:1280,height:800});fit=await fitMenu();assert(fit.items.every(i=>i.inside));assert(fit.scrollWidth<=fit.clientWidth&&fit.scrollHeight<=fit.clientHeight);
  const large=await page.locator('.menu-controls').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert(Math.abs(large-16.8)<.01);
  await snap('05-large-text-menu-1280x800');pass('Larger text increases essential menu copy while all laptop actions and controls remain in view',{fontSize:large,fit});
  await page.click('#settings-open');

  await page.setViewportSize({width:560,height:660});await page.locator('#settings-close').focus();await snap('06-settings-narrow-top');
  const geometry=await page.locator('#settings-panel').evaluate(e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
  assert(geometry.scrollHeight>geometry.clientHeight);assert(geometry.scrollWidth<=geometry.clientWidth+1);
  await page.locator('#settings-done').focus();await page.keyboard.press('Tab');assert.equal(await active(),'settings-close');
  await page.locator('#settings-done').focus();await snap('07-settings-narrow-bottom');
  const doneRect=await page.locator('#settings-done').boundingBox();assert(doneRect.y>=0&&doneRect.y+doneRect.height<=660);
  await page.keyboard.press('Enter');assert(await page.locator('#settings-panel').isHidden());assert.equal(await active(),'settings-open');pass('Narrow 560×660 settings at Larger text scroll vertically without horizontal overflow; keyboard reaches and activates Done',geometry);

  await page.setViewportSize({width:1280,height:800});await page.focus('#start');await page.keyboard.press('Enter');await page.waitForFunction(()=>kino.debug.getState().active);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!kino.debug.getState().active);assert.equal(errors.length,0,errors.join('\n'));pass('Resume remains functional after resizing/settings, with zero script, shader or asset errors');
}catch(error){checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack});console.error(error);await snap('failure').catch(()=>{});process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'Real Chrome keyboard interactions and rendered layout at laptop/narrow CSS viewports; not physical MacBook or screen-reader certification.'},null,2));await browser.close();}
