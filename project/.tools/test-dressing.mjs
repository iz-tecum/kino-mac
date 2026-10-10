import fs from 'node:fs';import path from 'node:path';import {chromium} from 'playwright-core';import {resolveChromeExecutable} from './browser-path.mjs';
const output=path.resolve('artifacts/v5-dressing');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const report={errors:[],failedRequests:[],views:[],method:'Same-position controlled visual comparison; not traversal or human listening proof.'};
try{for(const mode of ['before','after']){const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});page.on('requestfailed',r=>report.failedRequests.push(r.url()));page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`)});
if(mode==='before')await page.route('**/theater-dressing.js',r=>r.fulfill({body:'export async function restoreTheaterDressing(){return {disabledForComparison:true}}',contentType:'text/javascript'}));
await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:180000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true)});
await page.waitForTimeout(3500);
for(const [name,feet,target]of [['lobby',[-20,96,1470],[0,210,820]],['floor',[-280,96,1390],[-120,80,1130]],['dining',[1510,0,-210],[1410,-16,-520]]]){await page.evaluate(({feet,target})=>{kino.debug.teleportPlayer(feet);kino.debug.step(.3);kino.debug.lookAt(target)},{feet,target});await page.waitForTimeout(1800);await page.screenshot({path:path.join(output,`${mode}-${name}.png`)});report.views.push({mode,name,state:await page.evaluate(()=>kino.debug.getState()),map:await page.evaluate(()=>kino.debug.mapState())});}
await context.close();}
report.success=!report.errors.length&&!report.failedRequests.length;if(!report.success)process.exitCode=1;
}catch(e){report.success=false;report.failure=String(e);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,errors:[...new Set(report.errors)],errorCount:report.errors.length,failedRequests:report.failedRequests,failure:report.failure,views:report.views.length}));}
