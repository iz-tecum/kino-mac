import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';
const out='artifacts/v3-weapons/reload-bindings';fs.mkdirSync(out,{recursive:true});
// Reproduce only the inherited position bug for a controlled visual comparison.
const before=fs.readFileSync('export/web/animation.js','utf8').replace('useWeaponBindTranslations(gun);','').replace('useWeaponBindTranslations(leftGun);','');
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:500}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const step=(dt,options={})=>page.evaluate(({dt,options})=>{for(const v of lab.views)v.update(dt,options);lab.draw();return lab.parts();},{dt,options});
try{
  await page.route('**/animation-before-bind.js',route=>route.fulfill({contentType:'text/javascript',body:before}));
  await page.route('**/weapon-bindings-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0;background:#16191d;color:#ddd;font:16px sans-serif}header{display:flex;height:40px;align-items:center}header span{width:50%;padding-left:20px}canvas{display:block}</style><header><span>Before: weapon offset omitted</span><span>After: native weapon socket retained</span></header><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/jsm/"}}</script><script type="module">
  import * as THREE from 'three';import {ViewWeapon} from '/animation.js';import {ViewWeapon as Before} from '/animation-before-bind.js';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1440,450);renderer.setScissorTest(true);document.body.append(renderer.domElement);
  const data=await fetch('/game-data.json').then(r=>r.json()),scenes=[new THREE.Scene(),new THREE.Scene()],camera=new THREE.PerspectiveCamera(60,1.6,.01,200);
  for(const scene of scenes){scene.background=new THREE.Color(0x20252b);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,1.2));const light=new THREE.DirectionalLight(0xffefce,1);light.position.set(0,4,2);scene.add(light);}
  const views=[new Before(scenes[0],data),new ViewWeapon(scenes[1],data)];
  const parts=()=>views.map(v=>{const parts={};for(const name of ['tag_clip','j_clip','tag_battery_1','tag_battery_2']){const bone=v.gun.getObjectByName(name);if(bone)parts[name]={position:bone.position.toArray(),rotation:bone.quaternion.toArray()};}return {view:v.snapshot(),parts};});
  await Promise.all(views.map(v=>v.equip(data.weapons.m1911_zm)));
  window.lab={data,views,parts,draw:()=>{for(let i=0;i<2;i++){renderer.setViewport(i*720,0,720,450);renderer.setScissor(i*720,0,720,450);renderer.render(scenes[i],camera);}}};lab.draw();
  </script>`}));
  await page.goto('http://127.0.0.1:5173/weapon-bindings-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:60000});
  for(const id of ['m1911_zm','mp40_zm','m16_zm','ray_gun_zm'])for(const empty of [false,true]){
    const name=id+(empty?'-empty':'-partial');await page.evaluate(id=>Promise.all(lab.views.map(v=>{v.currentId=null;return v.equip(lab.data.weapons[id]);})),id);
    const rest=await step(2),duration=await page.evaluate(({id,empty})=>{const d=lab.data.weapons[id],duration=empty?d.reloadEmptyTime:d.reloadTime;for(const v of lab.views)v.reload(empty,duration);return duration;},{id,empty});
    const frames=[];
    for(let frame=0;frame<5;frame++){const pose=await step(duration*.2,{reloading:true});frames.push(pose);await page.screenshot({path:`${out}/${name}-${(frame+1)*20}.png`});}
    const ended=await step(.5);assert.equal(ended[1].view.mode,'idle');
    for(const [part,value] of Object.entries(rest[1].parts)){const current=ended[1].parts[part].position;assert(current.every((v,i)=>Math.abs(v-value.position[i])<.01),name+' reseats '+part);}
    await page.evaluate(({empty,duration})=>{for(const v of lab.views)v.reload(empty,duration);},{empty,duration});await step(duration*.45,{reloading:true});await step(.5,{reloading:false});const interrupted=await step(.2);
    for(const [part,value] of Object.entries(rest[1].parts))assert(interrupted[1].parts[part].position.every((v,i)=>Math.abs(v-value.position[i])<.01),name+' cancelled reload restores '+part);
    await page.screenshot({path:`${out}/${name}-interrupted.png`});checks.push({name,passed:true,rest,frames,ended,interrupted});console.log('PASS',name);
  }
  assert.equal(errors.length,0,errors.join('\n'));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Side-by-side actual native viewmodel render. Left reproduces the inherited missing-bind-offset bug only; right runs current code. Partial/empty reloads and interrupted reload restoration are sampled explicitly.',checks,errors},null,2));await browser.close();}
