import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {resolveChromeExecutable} from './browser-path.mjs';

const output=path.resolve('artifacts/v6-actor-rendering');fs.mkdirSync(output,{recursive:true});
const report={method:'Current integrated source; controlled spawns and normal AI/collision update. Comparison alone disables the new actor module through a test response. Paused screenshots hide only the pause menu to expose the frozen rendered frame.',checks:[],modes:{},errors:[]};
const check=(name,value,details)=>{report.checks.push({name,passed:!!value,details});assert(value,name);};
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  for(const mode of ['before','after']){
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),result={errors:[],failedRequests:[],views:{}};report.modes[mode]=result;
    page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});page.on('pageerror',e=>result.errors.push(String(e)));page.on('requestfailed',r=>result.failedRequests.push(r.url()));
    await page.addInitScript(()=>{let seed=1701;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};});
    if(mode==='before')await page.route('**/theater-actors.js',route=>route.fulfill({contentType:'text/javascript',body:'export class TheaterActors {update(){} reset(){} dispose(){} snapshot(){return {disabled:true};} sampleIllumination(){return null;}}'}));
    try {
      await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:180000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
      await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.pause();});
      for(const fixture of [
        {name:'sun-zombie',kind:'zombie',enemy:[-120,80,1300],viewer:[-120,82,1445]},
        {name:'shade-zombie',kind:'zombie',enemy:[-200,80,1150],viewer:[-200,82,1300]},
        {name:'hound',kind:'dog',enemy:[1400,-16,-200],viewer:[1400,-14,0],contact:true},
        {name:'nova',kind:'nova',enemy:[1400,-16,-200],viewer:[1400,-14,0],contact:true}
      ]){
        const sample=await page.evaluate(f=>{kino.debug.reset();kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.resume();kino.debug.teleportPlayer(f.viewer);kino.debug.step(.5);const id=kino.debug.spawnEnemy(f.enemy,f.kind);kino.debug.step(.2);kino.debug.lookAt([f.enemy[0],f.enemy[1]+(f.kind==='zombie'?34:22),f.enemy[2]]);kino.debug.pause();return {id,state:kino.debug.getState(),actors:kino.debug.actorRenderingState(),view:kino.debug.viewLightingState()};},fixture);
        await page.waitForTimeout(250);await page.screenshot({path:path.join(output,`${mode}-${fixture.name}.png`),style:'#menu{display:none!important}'});result.views[fixture.name]=sample;
        if(mode==='after'){check(`${fixture.name} receives bounded actor probe`,sample.actors.actors===1&&sample.actors.materials>0,sample.actors);if(fixture.contact)check(`${fixture.name} confirmed contact`,sample.actors.shadows===1,sample.actors);}
      }
      if(mode==='after'){
        check('sunlit torso receives directional sunlight',result.views['sun-zombie'].actors.samples[0].sun>.5,result.views['sun-zombie'].actors.samples[0]);
        check('shadowed torso rejects direct sunlight',result.views['shade-zombie'].actors.samples[0].sun<.05,result.views['shade-zombie'].actors.samples[0]);
        const frozen=await page.evaluate(()=>kino.debug.actorRenderingState());await page.waitForTimeout(600);check('pause preserves actor state exactly',JSON.stringify(frozen)===JSON.stringify(await page.evaluate(()=>kino.debug.actorRenderingState())));
        result.stress=await page.evaluate(()=>{kino.debug.reset();kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.resume();kino.debug.teleportPlayer([300,-14,-1250]);kino.debug.step(.3);for(let i=0;i<24;i++)kino.debug.spawnEnemy([-240+(i%8)*80,-16,-1350-Math.floor(i/8)*80],i%6===0?'dog':'zombie');kino.debug.step(.65);kino.debug.pause();return {actors:kino.debug.actorRenderingState(),state:kino.debug.getState()};});
        check('24 actor pool stays at one contact draw call',result.stress.actors.actors===24&&result.stress.actors.drawCalls===1&&result.stress.actors.triangles<=48&&result.stress.actors.rayBudget===10,result.stress.actors);
        result.dead=await page.evaluate(()=>{const id=kino.debug.getState().enemies[0].id;kino.debug.damageEnemy(id,999999);kino.debug.resume();kino.debug.step(.15);kino.debug.pause();return kino.debug.actorRenderingState();});check('corpse keeps bounded contact/material record',result.dead.actors===24&&result.dead.materials<=result.stress.actors.materials,result.dead);
        result.reset=await page.evaluate(()=>{kino.debug.reset();kino.debug.pause();return kino.debug.actorRenderingState();});check('restart releases all actor material records and contacts',result.reset.actors===0&&result.reset.materials===0&&result.reset.shadows===0,result.reset);
      }
      check(`${mode} no script/shader/asset errors`,!result.errors.length&&!result.failedRequests.length,{errors:result.errors,failedRequests:result.failedRequests});
    } finally {await context.close();}
  }
  report.success=report.checks.every(c=>c.passed);
}catch(error){report.success=false;report.failure=String(error);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,checks:report.checks.map(c=>({name:c.name,passed:c.passed})),failure:report.failure,errors:Object.fromEntries(Object.entries(report.modes).map(([k,v])=>[k,[...new Set(v.errors)]])),output}));}
