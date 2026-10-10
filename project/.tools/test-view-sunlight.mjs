import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v7-view-lighting';fs.mkdirSync(out,{recursive:true});
const report={method:'Controlled sunny/shaded placement in the actual game; before uses preserved1.5 view-lighting only. Both retain current geometry, shaders, graphics settings and native weapon. No human playthrough claim.',modes:{},checks:[],errors:[]};
const check=(name,value,data)=>{report.checks.push({name,passed:!!value,data});assert(value,name);};
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
try{
 for(const mode of ['before','after']){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  const r=report.modes[mode]={errors:[],views:{}};
  page.on('pageerror',e=>r.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.errors.push(m.text());});page.on('requestfailed',req=>r.errors.push(req.url()));
  if(mode==='before')await page.route('**/view-lighting.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('./fixtures/view-lighting-v1.5.js',import.meta.url),'utf8')}));
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
  await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.giveWeapon('commando_zm');});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
  for(const f of [{id:'sun-left',feet:[-110,82,1280],look:[-500,132,1250]},{id:'sun-right',feet:[-110,82,1280],look:[300,132,1150]},{id:'shade',feet:[-200,82,1150],look:[200,132,1000]}]){
   r.views[f.id]=await page.evaluate(f=>{kino.debug.resume();kino.debug.teleportPlayer(f.feet);kino.debug.step(.2);kino.debug.lookAt(f.look);kino.debug.step(2);kino.debug.pause();return{light:kino.debug.viewLightingState(),state:kino.debug.getState()};},f);
   await page.waitForTimeout(150);await page.screenshot({path:`${out}/${mode}-${f.id}.png`,style:'#menu{display:none!important}'});
  }
  if(mode==='after'){
   const a=r.views['sun-left'].light,b=r.views['sun-right'].light;
   check('sunlight changes its weapon-local direction as the player turns',Math.hypot(...a.keyPosition.map((v,i)=>v-b.keyPosition[i]))>1,{left:a,right:b});
   check('shade preserves the established readable fill',Math.hypot(...r.views.shade.light.keyPosition.map((v,i)=>v-[0,4,2][i]))<.01,r.views.shade.light);
   const paused=await page.evaluate(()=>kino.debug.viewLightingState());await page.waitForTimeout(250);check('paused light pose is stable',JSON.stringify(paused)===JSON.stringify(await page.evaluate(()=>kino.debug.viewLightingState())));
   await page.evaluate(()=>kino.debug.reset());const reset=await page.evaluate(()=>kino.debug.viewLightingState());check('restart restores key direction',JSON.stringify(reset.keyPosition)==='[0,4,2]',reset);
  }
  check(mode+' has no script/shader/asset errors',!r.errors.length,r.errors);await context.close();
 }
 report.success=true;
}catch(e){report.success=false;report.failure=String(e);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,checks:report.checks,failure:report.failure}));}
