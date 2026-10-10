import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';

const out=process.env.KINO_WEAPON_POSES_DIR??'artifacts/v3-weapons';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[],poses=[],weapons=[];
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const step=(seconds,options={})=>page.evaluate(({seconds,options})=>{for(let t=0;t<seconds;t+=1/120)lab.view.update(Math.min(1/120,seconds-t),options);lab.draw();return lab.view.snapshot();},{seconds,options});
const snap=name=>page.screenshot({path:`${out}/${name}.png`});
try{
  await page.route('**/weapon-pose-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/jsm/"}}</script><script type="module">
  import * as THREE from 'three';import {ViewWeapon} from '/animation.js';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x20252b);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,1.2));
  const light=new THREE.DirectionalLight(0xffefce,1);light.position.set(0,4,2);scene.add(light);
  const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200),data=await fetch('/game-data.json').then(r=>r.json());
  const notes=[],view=new ViewWeapon(scene,data,(name)=>notes.push(name));
  await view.equip(data.weapons.m1911_zm);window.lab={view,data,notes,draw:()=>renderer.render(scene,camera)};lab.draw();
  </script>`}));
  await page.goto('http://127.0.0.1:5173/weapon-pose-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:120000});
  const definitions=await page.evaluate(()=>Object.entries(lab.data.weapons).flatMap(([id,b])=>[{...b,id,upgraded:false},{...b,...b.upgrade,id,upgraded:true}]));
  for(const def of definitions){
    const key=def.id+(def.upgraded?'-upgraded':'');await page.evaluate(def=>lab.view.equip(def),def);
    const hip=await step(def.raiseTime+.1);assert.equal(hip.mode,'idle',key);assert(hip.canFire,key+' is ready');
    const aimed=await step(Math.max(.1,def.adsInTime)+.02,{ads:!def.dualWield});assert.equal(aimed.aim,def.dualWield?0:1,key+' ADS');
    assert(aimed.gun.every(Number.isFinite),key+' finite gun transform');
    const capture=['ithaca_zm','ray_gun_zm','m1911_zm','pm63_zm'].includes(def.id)&&(!def.upgraded||def.dualWield);
    if(capture)await snap(key+'-ads');
    const lowered=await step(Math.max(.01,def.adsOutTime)/2,{ads:false});if(capture)await snap(key+'-lowering');
    await step(Math.max(.1,def.adsOutTime)+.1);await page.evaluate(()=>lab.view.shoot({hand:'left',empty:true}));
    const shot=await step(.025);if(def.dualWield)assert.equal(shot.animation,'leftLastShotAnim',key+' left final shot');
    await step(2);await page.evaluate(def=>{lab.notes.length=0;lab.view.reload(true,def.reloadEmptyTime||def.reloadTime);},def);
    await step(.5,{reloading:true});if(capture)await snap(key+'-empty-reload');
    await step(Math.max(def.reloadEmptyTime,def.reloadTime)+.1,{reloading:true});await step(.1);
    if(def.id==='cz75dw_zm'&&!def.upgraded){const notes=await page.evaluate(()=>lab.notes);assert.equal(notes.filter(n=>n==='sndnt#fly_cz75_mag_out').length,2);pass('dual CZ75 emits both staggered magazine-out notifies',notes);}
    const sprint=await step(def.sprintInTime+def.sprintLoopTime+.1,{sprint:true});assert.equal(sprint.mode,'sprint',key+' sprint');assert(!sprint.canFire);
    const exit=await step(.001);assert.equal(exit.mode,'sprintOut',key+' starts authored sprint exit');assert(!exit.canFire);
    const ready=await step(def.sprintOutTime+.1);assert(ready.canFire,key+' exits sprint');assert.equal(ready.mode,'idle');
    poses.push({key,hip,aimed,lowered,shot,sprint,ready});
  }
  pass('64 native base/upgraded viewmodels: equip, ADS, release, empty reload, dual last shot, sprint recovery',{count:poses.length});
  await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');
  const state=()=>page.evaluate(()=>kino.debug.getState());
  const ready=async()=>{await page.waitForFunction(()=>kino.debug.getState().viewmodelReady,null,{timeout:20000});await page.evaluate(()=>kino.debug.step(2));};
  for(const def of definitions){
    await page.evaluate(id=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.giveWeapon(id);},def.id);await ready();
    if(def.upgraded){await page.evaluate(()=>{const ents=kino.debug.getEntities();kino.debug.grantPoints(5000);kino.debug.teleportPlayer(ents.find(e=>e.targetname==='use_elec_switch').position);assertUse();kino.debug.teleportPlayer(ents.find(e=>e.targetname==='zombie_vending_upgrade').position);assertUse();kino.debug.step(4.5);assertUse();function assertUse(){if(!kino.debug.interact())throw Error('upgrade setup interaction failed');}});await ready();}
    assert.equal((await state()).weapon.mag,def.clipSize);assert(await page.evaluate(()=>kino.debug.shoot()));
    assert.equal((await state()).weapon.mag,def.clipSize-1);await page.keyboard.press('KeyR');await page.evaluate(()=>kino.debug.step(12));
    const result=await state();assert.equal(result.weapon.mag,def.clipSize,def.name+' gameplay reload');weapons.push({id:def.id,upgraded:def.upgraded,mag:result.weapon.mag,passed:true});
  }
  pass('64 native base/upgraded guns fire and reload through the actual gameplay path',{count:weapons.length});
  for(const id of ['mp40_zm','ray_gun_zm']){
    await page.evaluate(id=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.giveWeapon(id);},id);await ready();
    const result=await page.evaluate(()=>{
      const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
      key('keydown','KeyW');key('keydown','ShiftLeft');kino.debug.step(.35);const sprint=kino.debug.weaponVisual(),mag=kino.debug.getState().weapon.mag,blockedSprint=!kino.debug.shoot();
      key('keyup','ShiftLeft');key('keyup','KeyW');kino.debug.step(.001);const exit=kino.debug.weaponVisual(),blockedExit=!kino.debug.shoot(),exitMag=kino.debug.getState().weapon.mag;
      kino.debug.step(.5);return {sprint,exit,mag,exitMag,blockedSprint,blockedExit,firesAfter:kino.debug.shoot(),final:kino.debug.weaponVisual()};
    });
    assert(result.blockedSprint&&result.blockedExit&&result.firesAfter,id+' sprint readiness integrated');assert.equal(result.mag,result.exitMag);pass(id+' gameplay blocks premature sprint firing and recovers',result);
  }
  await page.evaluate(()=>{kino.debug.giveWeapon('ithaca_zm');});await ready();
  const interrupted=await page.evaluate(()=>{
    for(let i=0;i<6;i++){kino.debug.shoot();kino.debug.step(.9);}kino.debug.reload();kino.debug.step(1.1);
    const before=kino.debug.getState(),queued=!kino.debug.shoot();kino.debug.step(2);const after=kino.debug.getState();
    return {before,queued,after,view:kino.debug.weaponVisual()};
  });
  assert(interrupted.queued);assert.equal(interrupted.after.weapon.mag+interrupted.after.weapon.reserve,interrupted.before.weapon.mag+interrupted.before.weapon.reserve-1);assert(!interrupted.after.reloadLeft);pass('gameplay shotgun interruption retains its queued shot after native reload-end animation',{before:interrupted.before.weapon,after:interrupted.after.weapon,view:interrupted.view});
  await page.evaluate(()=>{kino.debug.teleportPlayer([-115,100,1254]);kino.debug.lookAt([0,180,850]);kino.debug.step(1);kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');});await snap('gameplay-stakeout-final');
  assert.equal(errors.length,0,errors.join('\n'));pass('no browser rendering, loading, or script errors');
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;await snap('failure').catch(()=>{});}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Debug-assisted animation lab plus actual gameplay integration; controlled time, upgrades and invulnerability are test setup, not a survival playthrough.',checks,poses,weapons,errors},null,2));await browser.close();}
