import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import {resolveChromeExecutable} from './browser-path.mjs';
const output=path.resolve(process.env.KINO_MAP_CAPTURE||'artifacts/map-v2');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const report={url:process.env.KINO_URL||'http://127.0.0.1:5173/',method:'Controlled visual inspection; teleports are not traversal proof',errors:[],requests:[],views:[]};
page.on('pageerror',e=>report.errors.push(String(e)));page.on('requestfailed',r=>report.requests.push(r.url()));
page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`)});
try{
 await page.goto(report.url);await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});
 await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true)});
 async function capture(name,feet,target){
  await page.evaluate(({feet,target})=>{kino.debug.teleportPlayer(feet);kino.debug.step(.3);kino.debug.lookAt(target)},{feet,target});
  await page.waitForTimeout(1400);await page.screenshot({path:path.join(output,`${name}.png`)});
  report.views.push({name,state:await page.evaluate(()=>kino.debug.getState())});
 }
 await capture('01-lobby-unpowered',[-101,108,1256],[0,240,650]);
 await page.evaluate(()=>{const e=kino.debug.getEntities().find(e=>e.targetname==='use_elec_switch');kino.debug.teleportPlayer([e.position[0],e.position[1]-55,e.position[2]]);kino.debug.step(.2);kino.debug.interact()});
 await capture('02-lobby-powered',[-101,108,1256],[0,240,650]);
 await capture('03-upper-hall',[1020,325,970],[1550,365,575]);
 await capture('04-dining',[1540,0,-360],[1330,100,-680]);
 await capture('05-dressing',[1340,0,-1320],[830,85,-1100]);
 await capture('06-theater',[0,-60,-650],[0,160,-1650]);
 await capture('07-stage',[50,0,-1720],[0,190,-250]);
 await capture('08-alley',[-1580,10,-540],[-1600,170,240]);
 await capture('09-projection',[-139,328,436],[80,370,150]);
 report.success=report.errors.length===0&&report.requests.length===0;
}catch(e){report.success=false;report.failure=String(e);process.exitCode=1}
finally{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({success:report.success,errors:report.errors,failedRequests:report.requests,views:report.views.length,output}))}
