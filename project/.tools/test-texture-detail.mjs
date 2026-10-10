import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v7-texture-detail';fs.mkdirSync(out,{recursive:true});
const report={method:'Actual native images at normal player height; controlled view, same current source with only TextureDetail disabled for before. No source image, UV, mip generation, or geometry modifications.',modes:{},checks:[],errors:[]};
const check=(name,value,data)=>{report.checks.push({name,passed:!!value,data});assert(value,name);};
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
try{
 for(const mode of ['before','after']){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),r=report.modes[mode]={errors:[],views:{}};
  page.on('pageerror',e=>r.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.errors.push(m.text());});page.on('requestfailed',req=>r.errors.push(req.url()));
  if(mode==='before')await page.route('**/texture-detail.js',route=>route.fulfill({contentType:'text/javascript',body:'export class TextureDetail{setQuality(){}register(){}snapshot(){return{disabled:true}}}'}));
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);});
  for(const f of [{id:'lobby-floor',feet:[-110,82,1280],look:[-200,80,800]},{id:'lobby-stairs',feet:[-200,82,1150],look:[280,245,730]}]){
   r.views[f.id]=await page.evaluate(f=>{kino.debug.resume();kino.debug.teleportPlayer(f.feet);kino.debug.step(.5);kino.debug.lookAt(f.look);kino.debug.step(1);kino.debug.pause();return{texture:kino.debug.textureDetailState(),state:kino.debug.getState()};},f);
   await page.waitForTimeout(150);await page.screenshot({path:`${out}/${mode}-${f.id}.png`,style:'#menu{display:none!important}'});
  }
  if(mode==='after'){
   const t=r.views['lobby-floor'].texture;check('balanced filter uses hardware-capped colour and normal levels',t.colourLevel===Math.min(t.hardwareMaximum,8)&&t.normalLevel===Math.min(t.hardwareMaximum,4)&&t.textures>200&&t.newTextures===0,t);
   const count=t.textures;
   await page.evaluate(()=>document.exitPointerLock?.());await page.locator('#settings-open').click();await page.locator('[data-setting="quality"]').selectOption('performance');
   const performance=await page.evaluate(()=>kino.debug.textureDetailState());check('actual Performance setting lowers filters without new images',performance.colourLevel<=2&&performance.normalLevel<=2&&performance.textures===count,performance);
   await page.locator('[data-setting="quality"]').selectOption('quality');const quality=await page.evaluate(()=>kino.debug.textureDetailState());check('actual Quality setting caps filtering to hardware',quality.colourLevel===Math.min(16,quality.hardwareMaximum)&&quality.textures===count,quality);
   await page.locator('[data-setting="quality"]').selectOption('balanced');await page.locator('#settings-done').click();await page.evaluate(()=>kino.debug.reset());await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);const reset=await page.evaluate(()=>kino.debug.textureDetailState());check('restart reuses existing samplers',reset.textures===count&&reset.colourLevel===Math.min(8,reset.hardwareMaximum),reset);
  }
  check(mode+' no shader/script/asset errors',!r.errors.length,r.errors);await context.close();
 }
 report.success=true;
}catch(e){report.success=false;report.failure=String(e);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,checks:report.checks,failure:report.failure}));}
