import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChromeExecutable } from './browser-path.mjs';
const out='artifacts/v3-weapons/aug-pump';fs.mkdirSync(out,{recursive:true});
const before=fs.readFileSync('export/web/animation.js','utf8').replace('entries=retargetAugPump(gun,def,entries);','');
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:500}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
try{
  await page.route('**/animation-before-pump.js',route=>route.fulfill({contentType:'text/javascript',body:before}));
  await page.route('**/aug-pump-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0;background:#16191d;color:#ddd;font:16px sans-serif}header{display:flex;height:40px;align-items:center}header span{width:50%;padding-left:20px}canvas{display:block}</style><header><span>Before: inconsistent native pump basis</span><span>After: pump matches bind and sprint basis</span></header><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/jsm/"}}</script><script type="module">
  import * as THREE from 'three';import {ViewWeapon} from '/animation.js';import {ViewWeapon as Before} from '/animation-before-pump.js';
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1440,450);renderer.setScissorTest(true);document.body.append(renderer.domElement);
  const data=await fetch('/game-data.json').then(r=>r.json()),scenes=[new THREE.Scene(),new THREE.Scene()],camera=new THREE.PerspectiveCamera(60,1.6,.01,200);
  for(const scene of scenes){scene.background=new THREE.Color(0x20252b);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,1.2));const light=new THREE.DirectionalLight(0xffefce,1);light.position.set(0,4,2);scene.add(light);}
  const views=[new Before(scenes[0],data),new ViewWeapon(scenes[1],data)];
  const parts=()=>views.map(v=>{const bones={};v.root.traverse(b=>{if(b.isBone)bones[b.name]={position:b.position.toArray(),rotation:b.quaternion.toArray(),scale:b.scale.toArray()};});return {bones,view:v.snapshot()};});
  const base=data.weapons.aug_acog_zm,defs={base,rifle:{...base,...base.upgrade,id:base.id,upgraded:true},attachment:{...base.upgrade.attachment,upgraded:true,attachmentActive:true}};
  window.lab={views,defs,parts,draw:()=>{for(let i=0;i<2;i++){renderer.setViewport(i*720,0,720,450);renderer.setScissor(i*720,0,720,450);renderer.render(scenes[i],camera);}}};
  </script>`}));
  await page.goto('http://127.0.0.1:5173/aug-pump-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:60000});
  for(const variant of ['base','rifle','attachment']){
    await page.evaluate(variant=>Promise.all(lab.views.map(v=>v.equip(lab.defs[variant]))),variant);
    await page.evaluate(()=>{for(const v of lab.views)v.update(3);});
    const poses=variant==='attachment'?[['idleAnim',0],['reloadStartAnim',.4],['reloadAnim',.4],['reloadEndAnim',.8],['reloadEndAnim',2],['sprintInAnim',.15]]:[['idleAnim',0],['reloadAnim',1],['reloadEmptyAnim',1.4],['reloadEmptyAnim',5],['sprintInAnim',.15]];
    for(const [key,time] of poses){
      const state=await page.evaluate(({key,time})=>{for(const v of lab.views){v.rig.play('idleAnim',true,1,0);v.rig.update(0);if(key.startsWith('reload'))v.reloadProps.begin(key==='reloadEndAnim'?'end':key==='reloadStartAnim'?'start':'shell');else v.reloadProps.set(false);v.rig.play(key,false,1,0);v.rig.update(time);v.applyAim(true);}lab.draw();return lab.parts();},{key,time});
      for(const [name,bone] of Object.entries(state[1].bones))if(name!=='tag_pump2')assert.deepEqual(bone,state[0].bones[name],variant+' '+key+' preserves '+name);
      const pump=state[1].bones.tag_pump2;
      if(variant==='base')assert.deepEqual(pump,state[0].bones.tag_pump2,'ordinary AUG remains identical');
      else{const q=pump.rotation,dot=Math.abs(q[2]*-Math.SQRT1_2+q[3]*Math.SQRT1_2);assert(2*Math.acos(Math.min(1,dot))<.001,variant+' '+key+' aligned pump');}
      const name=`${variant}-${key}-${time}`;await page.screenshot({path:`${out}/${name}.png`});checks.push({name,passed:true,state});console.log('PASS',name);
    }
    // Exercise the public cancellation path after a reload, restoring its idle.
    const interrupted=await page.evaluate(()=>{for(const v of lab.views){v.reload(false,v.def.reloadTime);v.update(.3,{reloading:true});v.update(.5,{reloading:false});v.update(.5);}lab.draw();return lab.parts();});
    assert.equal(interrupted[1].view.mode,'idle');if(variant!=='base')assert(Math.abs(interrupted[1].bones.tag_pump2.rotation[0])<.001);
    await page.screenshot({path:`${out}/${variant}-interrupted.png`});checks.push({name:variant+' interrupted reload',passed:true,state:interrupted});
  }
  assert.equal(errors.length,0,errors.join('\n'));
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack});console.error(error);process.exitCode=1;}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Side-by-side native viewmodel browser render. Left omits only the targeted AUG pump basis retarget; right is current runtime. Normal AUG, upgraded rifle, and Masterkey clips plus interrupted reloads are sampled. All other bone transforms must be identical.',checks,errors},null,2));await browser.close();}
