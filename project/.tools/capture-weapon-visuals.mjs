import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { resolveChromeExecutable } from './browser-path.mjs';
const out=process.env.KINO_WEAPONS_DIR||'artifacts/desktop-weapons';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],captures=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
  await page.goto(process.env.KINO_URL||'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});
  await page.click('#start');
  for(const id of ['m1911_zm','ithaca_zm','ray_gun_zm','thundergun_zm']){
    await page.evaluate(id=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.giveWeapon(id);},id);
    await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
    await page.evaluate(()=>{
      const ents=kino.debug.getEntities();
      kino.debug.grantPoints(5000);
      kino.debug.teleportPlayer(ents.find(e=>e.targetname==='use_elec_switch').position);kino.debug.interact();
      kino.debug.teleportPlayer(ents.find(e=>e.targetname==='zombie_vending_upgrade').position);kino.debug.interact();
      kino.debug.step(4.5);kino.debug.interact();
    });
    await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
    await page.evaluate(()=>{kino.debug.teleportPlayer([-115,100,1254]);kino.debug.lookAt([0,180,850]);kino.debug.step(5);});
    await page.waitForTimeout(500);
    await page.evaluate(()=>{kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');});
    const filename=`${id}-upgraded-lobby.png`;
    await page.screenshot({path:`${out}/${filename}`});
    captures.push({filename,state:await page.evaluate(()=>kino.debug.getState())});
    await page.evaluate(()=>kino.debug.resume());
  }
}finally{
  fs.writeFileSync(`${out}/visual-report.json`,JSON.stringify({setup:'Debug-assisted upgrade purchases and safe lobby camera placement; actual browser-rendered screenshots.',captures,errors},null,2));
  await browser.close();
}
