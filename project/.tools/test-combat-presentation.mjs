import {chromium} from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolveChromeExecutable} from './browser-path.mjs';
const out=process.env.KINO_COMBAT_OUT??'artifacts/v5-combat';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
const pass=(name,detail)=>{checks.push({name,passed:true,detail});console.log('PASS',name);};
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const screenshot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
 await page.route('**/combat-presentation-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0;background:#171a1e;color:#e6dfd0;font:16px sans-serif}header{position:absolute;left:24px;top:20px}canvas{display:block}</style><header id="caption">Native weapon motion and impact rendering</header><script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/jsm/"}}</script><script type="module">
 import * as THREE from 'three';import {ViewWeapon} from '/animation.js';import {CombatParticles} from '/combat-particles.js';
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x20252b);scene.add(new THREE.HemisphereLight(0xffffff,0x8899aa,1.2));const light=new THREE.DirectionalLight(0xffefce,1);light.position.set(0,4,2);scene.add(light);
 const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,.01,200),data=await fetch('/game-data.json').then(r=>r.json()),notes=[],view=new ViewWeapon(scene,data,name=>notes.push(name));
 const effects=new THREE.Scene();effects.background=new THREE.Color(0x20252b);const wall=new THREE.Mesh(new THREE.PlaneGeometry(330,200),new THREE.MeshBasicMaterial({color:0x4a4d4d}));wall.position.set(0,45,-2);effects.add(wall);const effectCamera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,1,1000);effectCamera.position.set(0,60,240);effectCamera.lookAt(0,40,0);
 let seed=1234;const pool=new CombatParticles(effects,512,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296));
 await view.equip(data.weapons.m1911_zm);window.lab={THREE,renderer,view,data,notes,scene,effects,pool,camera,effectCamera,draw:()=>renderer.render(scene,camera),drawEffects:()=>renderer.render(effects,effectCamera)};lab.draw();
 </script>`}));
 await page.goto('http://127.0.0.1:5173/combat-presentation-test.html');await page.waitForFunction(()=>window.lab,null,{timeout:120000});
 const continuity=await page.evaluate(()=>{
  const v=lab.view;v.update(2);v.update(.3,{moving:true,speed:190});const walking=v.snapshot();v.update(0,{moving:true,sprint:true,speed:285});const changed=v.snapshot();
  for(let n=0;n<60;n++)v.update(1/60,{moving:true,speed:0});const stopped=v.snapshot();
  for(let n=0;n<60;n++)v.update(1/60,{moving:true,speed:190,ads:true});const ads=v.snapshot();lab.draw();
  return {walking,changed,stopped,ads,camera:lab.camera.position.toArray()};
 });
 assert.deepEqual(continuity.walking.motion.offset,continuity.changed.motion.offset);assert(continuity.stopped.motion.weight<.00001);assert.equal(continuity.ads.aim,1);assert(continuity.ads.motion.offset.slice(0,2).every(n=>Math.abs(n)<1e-8));assert.deepEqual(continuity.camera,[0,0,0]);pass('native viewmodel keeps continuous motion, rests against walls and preserves steady ADS',continuity);await screenshot('01-steady-native-ads');
 const cancelled=await page.evaluate(()=>{
  const v=lab.view,d=v.def,clip=v.rig.data.reloadAnim,notify=clip.notifies.find(n=>n.name.startsWith('sndnt#')&&n.time>.05),at=notify.time/(clip.duration/d.reloadTime);
  v.reload(false,d.reloadTime);v.update(at-.005,{reloading:true});lab.notes.length=0;v.update(.02,{reloading:false});const notes=lab.notes.slice();v.update(.3);lab.draw();
  const bone=v.gun.getObjectByName('tag_clip');return {notify,notes,mode:v.mode,position:bone.position.toArray(),bind:bone.userData.weaponBindPosition};
 });
 assert(!cancelled.notes.includes(cancelled.notify.name));assert.equal(cancelled.mode,'idle');assert(cancelled.position.every((n,i)=>Math.abs(n-cancelled.bind[i])<.01));pass('actual native M1911 cancelled reload does not emit its next sound and magazine returns to socket',cancelled);await screenshot('02-cancelled-reload-seated-magazine');
 const rendered=await page.evaluate(()=>{
  const {pool,THREE}=lab;for(const [i,kind,color] of [[0,'wall',0xb8a388],[1,'wood',0x987354],[2,'metal',0xffc76b],[3,'blood',0xa52b22]])pool.emit(new THREE.Vector3(-90+i*60,40,0),color,28,{kind,normal:new THREE.Vector3(0,0,1)});
  pool.update(.08,900);lab.drawEffects();document.getElementById('caption').textContent='Actual pooled impacts · masonry dust / wood / metal sparks / blood';return pool.snapshot();
 });
 assert.equal(rendered.active,112);assert.equal(rendered.drawCalls,1);assert.equal(Object.keys(rendered.byKind).length,4);pass('all four impact materials compile and render through one fixed draw call',rendered);await screenshot('03-directional-impact-materials');
 const bounded=await page.evaluate(()=>{
  const {pool,THREE,renderer}=lab,before={...renderer.info.memory},objectCount=lab.effects.children.length,geometry=pool.geometry,buffer=pool.positions.buffer;
  const samples=[];for(let cycle=0;cycle<4;cycle++){for(let frame=0;frame<120;frame++){pool.emit(new THREE.Vector3(0,40,0),0xffbb44,40,{kind:'blast'});pool.update(1/60,900);}lab.drawEffects();samples.push({pool:pool.snapshot(),memory:{...renderer.info.memory}});pool.reset();}
  return {before,samples,after:pool.snapshot(),sameGeometry:geometry===pool.geometry,sameBuffer:buffer===pool.positions.buffer,objectCount,finalObjects:lab.effects.children.length};
 });
 assert(bounded.sameGeometry&&bounded.sameBuffer);assert.equal(bounded.objectCount,bounded.finalObjects);for(const sample of bounded.samples){assert(sample.pool.active<=512);assert.deepEqual(sample.memory,bounded.before);}assert.equal(bounded.after.active,0);pass('four sustained impact stress/reset cycles retain identical GPU buffers and allocations',bounded);
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.kino?.debug.getState().ready,null,{timeout:120000});await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.giveWeapon('mp40_zm');});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await page.evaluate(()=>kino.debug.step(2));
 const movement=await page.evaluate(()=>{
  const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
  const before=kino.debug.getState().player.feet;key('keydown','KeyW');kino.debug.step(.35);key('keyup','KeyW');const walking=kino.debug.weaponVisual(),after=kino.debug.getState().player.feet;
  kino.debug.teleportPlayer([301,245,600]);kino.debug.lookAt([301,305,500]);kino.debug.step(.2);key('keydown','KeyW');kino.debug.step(2);const wallStart=kino.debug.getState().player.feet;kino.debug.step(.6);const wallEnd=kino.debug.getState().player.feet,stopped=kino.debug.weaponVisual();key('keyup','KeyW');
  return {before,after,walking,wallStart,wallEnd,stopped};
 });
 assert(Math.hypot(movement.after[0]-movement.before[0],movement.after[2]-movement.before[2])>15);assert(movement.walking.motion.weight>.3);assert(Math.hypot(movement.wallEnd[0]-movement.wallStart[0],movement.wallEnd[2]-movement.wallStart[2])<2);assert(movement.stopped.motion.weight<.02);pass('actual collision-limited movement drives weapon motion; held input against a wall settles',movement);
 const wall=await page.evaluate(()=>{
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',bubbles:true}));kino.debug.step(.4);window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyS',bubbles:true}));const state=kino.debug.getState();kino.debug.lookAt([301,state.player.position[1],500]);kino.debug.step(.5);const shot=kino.debug.shoot();kino.debug.step(.04);const result={shot,impact:kino.debug.mapState().particles,lastShot:kino.debug.lastShot()};kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');return result;
 });
 assert(wall.shot);assert(['wall','wood','metal'].includes(wall.impact.lastEmission.kind));assert(wall.impact.lastEmission.normal);assert(wall.impact.active>0);pass('actual bullet collision emits a surface-normal material impact',wall);await screenshot('04-gameplay-wall-impact');
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.giveWeapon('m14_zm');});await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
 const flesh=await page.evaluate(()=>{
  kino.debug.step(2);const id=kino.debug.spawnEnemy([-101,kino.debug.getState().player.feet[1],1140],'zombie');kino.debug.step(.1);kino.debug.aimAtEnemy(id,true);const shot=kino.debug.shoot();kino.debug.step(.04);const result={shot,impact:kino.debug.mapState().particles,lastShot:kino.debug.lastShot(),state:kino.debug.getState()};kino.debug.pause();document.getElementById('menu').hidden=true;document.body.classList.remove('menu-open');return result;
 });
 assert(flesh.shot);assert(flesh.lastShot.target);assert.equal(flesh.impact.lastEmission.kind,'blood');assert(flesh.impact.active>0);pass('actual enemy hit emits blood while authoritative damage/ammunition remain in Session',flesh);await screenshot('05-gameplay-blood-impact');
 const pausedBefore=await page.evaluate(()=>({time:kino.debug.getState().time,motion:kino.debug.weaponVisual().motion,particles:kino.debug.mapState().particles}));await page.waitForTimeout(350);const pausedAfter=await page.evaluate(()=>({time:kino.debug.getState().time,motion:kino.debug.weaponVisual().motion,particles:kino.debug.mapState().particles}));assert.deepEqual(pausedAfter,pausedBefore);pass('actual pause freezes secondary motion and particle lifetimes',pausedAfter);
 await page.evaluate(()=>kino.debug.reset());await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);const reset=await page.evaluate(()=>({motion:kino.debug.weaponVisual().motion,particles:kino.debug.mapState().particles}));assert.equal(reset.motion.kick,0);assert.equal(reset.particles.active,0);assert.equal(reset.particles.emitted,0);pass('new game clears every previous-run kick and impact',reset);
 assert.equal(errors.length,0,errors.join('\n'));pass('zero browser script, WebGL shader, or asset errors');
}catch(error){checks.push({passed:false,error:String(error),stack:error.stack,state:await page.evaluate(()=>window.kino?{state:kino.debug.getState(),motion:kino.debug.weaponVisual().motion,particles:kino.debug.mapState().particles}:null).catch(()=>null)});console.error(error);process.exitCode=1;await screenshot('failure').catch(()=>{});}
finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify({method:'Native viewmodel and pooled-effects WebGL lab followed by actual game input/collision/impact integration. Debug positions, invulnerability and simulation steps are controlled test setup, not a survival playthrough.',checks,errors},null,2));await browser.close();}
