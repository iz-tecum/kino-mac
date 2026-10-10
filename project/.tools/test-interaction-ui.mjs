import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_UI_DIR??'artifacts/v4-interface';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
const screenshot=name=>page.screenshot({path:`${out}/${name}.png`});
const state=()=>page.evaluate(()=>{kino.debug.step(.001);return {ui:kino.debug.interactionState(),game:kino.debug.getState(),text:document.getElementById('prompt').innerText};});
async function target(selector){return page.evaluate(selector=>{const e=kino.debug.getEntities().find(e=>Object.entries(selector).every(([k,v])=>e[k]===v));if(!e)throw Error('No target '+JSON.stringify(selector));for(const height of (e.targetname==='zombie_vending_upgrade'?[0,-55]:[-55,0]))for(const radius of [80,55,35,0])for(let i=0;i<12;i++){const a=i*Math.PI/6,p=[e.position[0]+Math.sin(a)*radius,e.position[1]+height,e.position[2]+Math.cos(a)*radius];kino.debug.teleportPlayer(p);kino.debug.lookAt(e.position);kino.debug.step(.02);const u=kino.debug.interactionState();if(u.visible&&u.id===String(e.id))return {entity:e,ui:u,probe:kino.debug.interactionProbe(e.id)};}throw Error('No clear interaction pose for '+e.targetname+' '+e.id);},selector);}
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await screenshot('01-menu-1440');
 await page.click('#settings-open');assert(await page.locator('#settings-panel').isVisible());await screenshot('02-settings-1440');await page.click('#settings-done');
 await page.click('#start');await page.evaluate(()=>{kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.clearEnemies();});
 await target({targetname:'weapon_upgrade',zombie_weapon_upgrade:'m14_zm'});let s=await state();assert.equal(s.ui.title,'M14');assert.equal(s.ui.cost,500);assert(s.ui.available);assert(s.text.includes('500 PTS'));await screenshot('03-wall-weapon-affordable');
 const before=s.game.points;await page.keyboard.press('KeyF');await page.evaluate(()=>kino.debug.step(.1));await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);s=await state();assert.equal(s.game.points,before-500);assert.equal(s.ui.kind,'ammo');assert(!s.ui.available);assert.equal(s.ui.reason,'Reserve ammo full');await screenshot('04-wall-ammo-full');
 const fullPoints=s.game.points;await page.keyboard.press('KeyF');s=await state();assert.equal(s.game.points,fullPoints);pass('wall weapon purchase becomes full-ammo card and cannot spend again',s.ui);
 await target({targetname:'weapon_upgrade',zombie_weapon_upgrade:'mp40_zm'});s=await state();assert(!s.ui.available);assert.equal(s.ui.shortfall,1000);assert(s.text.includes('Need 1,000 more points'));await screenshot('05-wall-weapon-shortfall');pass('unaffordable weapon shows exact point deficit',s.ui);
 await target({targetname:'zombie_vending',script_noteworthy:'specialty_armorvest'});s=await state();assert(!s.ui.available);assert.equal(s.ui.reason,'Restore the power first');await screenshot('06-perk-power-required');pass('locked machine shows power requirement instead of misleading purchase action',s.ui);
 await page.evaluate(()=>{const b=kino.debug.getState().barriers[0];kino.debug.setBoards(b.id,0);const p=b.position;kino.debug.teleportPlayer([p[0]+b.inside[0]-p[0],b.inside[1],p[2]+b.inside[2]-p[2]]);kino.debug.lookAt([p[0],p[1]+25,p[2]]);kino.debug.step(.02);});
 // Find a real clear side of the window; geometry and range still select it.
 const barrier=await page.evaluate(()=>{const b=kino.debug.getState().barriers[0];for(const height of [-30,0])for(const radius of [55,35,75])for(let i=0;i<12;i++){const a=i*Math.PI/6,p=[b.position[0]+Math.sin(a)*radius,b.position[1]+height,b.position[2]+Math.cos(a)*radius];kino.debug.teleportPlayer(p);kino.debug.lookAt([b.position[0],b.position[1]+25,b.position[2]]);kino.debug.step(.02);const ui=kino.debug.interactionState();if(ui.id==='barrier-'+b.id)return b;}throw Error('No barrier pose');});
 s=await state();assert.equal(s.ui.count,0);assert.equal(s.ui.total,6);await screenshot('07-barrier-damaged');
 await page.keyboard.down('KeyF');await page.waitForTimeout(180);s=await state();assert(s.ui.holding);assert(s.ui.count>0&&s.ui.count<6);assert(s.ui.progress>0&&s.ui.progress<1);await screenshot('08-barrier-hold-progress');pass('held repair shows real boards and next-board progress',s.ui);
 await page.evaluate(()=>kino.debug.step(5));await page.keyboard.up('KeyF');s=await state();assert.equal(s.ui.count,6);assert(!s.ui.available);assert.equal(s.ui.reason,'Barricade secured');await screenshot('09-barrier-secured');pass('complete barricade hides action and stops repair',s.ui);
 await page.evaluate(()=>kino.debug.grantPoints(10000));const boxId=await page.evaluate(()=>kino.debug.specialState().boxLocation);await target({id:boxId});await screenshot('10-mystery-box-ready');await page.keyboard.press('KeyF');s=await state();assert(!s.ui.available);assert.equal(s.ui.reason,'Choosing a weapon');await screenshot('11-mystery-box-choosing');
 await page.evaluate(()=>kino.debug.step(6));s=await state();assert(s.ui.available);assert.equal(s.ui.action,'Take weapon');assert(s.ui.detail.includes('seconds to claim'));await screenshot('12-mystery-box-claim');pass('Mystery Box card follows purchase, rolling, and claim phases',s.ui);
 await target({targetname:'use_elec_switch'});await page.keyboard.press('KeyF');assert((await state()).game.power);
 await target({targetname:'zombie_vending_upgrade'});s=await state();assert.equal(s.ui.cost,5000);assert(s.ui.available);await screenshot('13-pack-purchase');await page.keyboard.press('KeyF');s=await state();assert(!s.ui.available);assert.equal(s.ui.reason,'Upgrading your weapon');await screenshot('14-pack-upgrading');
 await page.evaluate(()=>kino.debug.step(5));s=await state();assert(s.ui.available);assert.equal(s.ui.action,'Retrieve weapon');await screenshot('15-pack-retrieve');await page.keyboard.press('KeyF');pass('Pack-a-Punch card follows cost, pending, and retrieval phases',s.ui);
 // Layout uses the real game UI at compact desktop and narrow portrait widths.
 for(const size of [{width:960,height:540},{width:390,height:844}]){
   await page.setViewportSize(size);await target({targetname:'weapon_upgrade',zombie_weapon_upgrade:'mp40_zm'});await screenshot(`16-card-${size.width}`);
   const bounds=await page.locator('#prompt').boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width&&bounds.y+bounds.height<=size.height);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);assert(!(await state()).ui.visible);await screenshot(`17-menu-${size.width}`);
   await page.click('#settings-open');const panel=await page.locator('#settings-panel').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=size.width);await screenshot(`18-settings-${size.width}`);await page.click('#settings-done');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert(!overflow,'No horizontal menu overflow');pass('responsive interaction, menu, and settings '+size.width+'×'+size.height,{bounds,panel});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 }
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);assert.equal((await state()).ui.visible,false);pass('pause hides interaction card');assert.equal(errors.length,0,errors.join('\n'));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack,state:await state().catch(()=>null)});console.error(error);process.exitCode=1;await screenshot('failure').catch(()=>{});}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Controlled actual-game UI acceptance using debug positioning, points, time steps and invulnerability; actual F-key purchases and held repair. Visual comparisons and responsive layouts are inspected separately; this is not a survival playthrough.',checks,errors},null,2));await browser.close();}
