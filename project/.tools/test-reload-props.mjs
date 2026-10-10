import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';
const out='artifacts/v3-weapons/reload-props';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const step=(dt,options={})=>page.evaluate(({dt,options})=>{lab.view.update(dt,options);lab.draw();return lab.view.snapshot();},{dt,options});
try{
  await page.route('**/reload-props-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/jsm/"}}</script><script type="module">
  import * as THREE from 'three';import {ViewWeapon} from '/animation.js';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x20252b);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,1.2));
  const light=new THREE.DirectionalLight(0xffefce,1);light.position.set(0,4,2);scene.add(light);
  const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200),data=await fetch('/game-data.json').then(r=>r.json()),view=new ViewWeapon(scene,data);
  await view.equip(data.weapons.ithaca_zm);window.lab={view,data,draw:()=>renderer.render(scene,camera),pick:()=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(842/1440*2-1,1-450/900*2),camera);return ray.intersectObject(view.root,true).map(hit=>({mesh:hit.object.name,point:hit.point.toArray()}));}};lab.draw();
  </script>`}));
  await page.goto('http://127.0.0.1:5173/reload-props-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:60000});
  const definitions=await page.evaluate(()=>Object.entries(lab.data.weapons).flatMap(([id,b])=>[{...b,id,upgraded:false},{...b,...b.upgrade,id,upgraded:true},...(b.upgrade?.attachment?[{...b.upgrade.attachment,attachmentActive:true}]:[])]).filter(d=>d.segmentedReload&&(d.pellets>1||(d.projectileSpeed>0&&d.projectileType==='grenade'))));
  for(const def of definitions){
    const key=def.id+(def.upgraded?'-upgraded':'');await page.evaluate(def=>lab.view.equip(def),def);const idle=await step(def.raiseTime+1);assert(!idle.reloadProps.visible);assert(idle.reloadProps.tags.length>0,key+' tagged reload prop');
    const duration=def.reloadStartTime>0?def.reloadStartTime:def.reloadTime,stage=def.reloadStartTime>0?'start':'shell';
    const cue=await page.evaluate(({duration,stage})=>{lab.view.reload(false,duration,stage);const clip=lab.view.rig.data[lab.view.rig.current];return clip.notifies.find(n=>n.name==='rmbnt#reload_clipin'||n.name.endsWith('_shell_in'))?.time/clip.duration*duration;},{duration,stage});
    assert(cue>0,key+' native insertion cue');const loading=await step(cue/2,{reloading:true});assert(loading.reloadProps.visible,key+' prop visible in loading hand');
    await page.screenshot({path:`${out}/${key}-loading.png`});const inserted=await step(cue/2+.005,{reloading:true});assert(!inserted.reloadProps.visible,key+' inserted prop is hidden');
    await step(duration+1);await page.evaluate(()=>lab.view.reload(false,.4,'end'));const ended=await step(.1,{reloading:true});assert(!ended.reloadProps.visible);await step(1);
    await page.evaluate(()=>lab.view.reload(false,.5,'shell'));assert((await step(.01,{reloading:true})).reloadProps.visible);const cancelled=await step(.01);assert(!cancelled.reloadProps.visible,key+' interrupted reload clears prop');
    if(def.id==='ithaca_zm'&&!def.upgraded){await step(.4,{ads:true});await step(.1,{ads:false});const hits=await page.evaluate(()=>lab.pick());assert(!hits.some(h=>h.mesh==='surf3'),'the former floating shell is no longer pickable above the barrel');await page.screenshot({path:`${out}/stakeout-lowering-corrected.png`});}
    checks.push({name:key,passed:true,tags:idle.reloadProps.tags,cue,loading,inserted,cancelled});console.log('PASS',key);
  }
  assert.equal(errors.length,0,errors.join('\n'));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Actual native viewmodels rendered in an isolated animation fixture; reload state and source insertion cues advanced explicitly.',checks,errors},null,2));await browser.close();}
