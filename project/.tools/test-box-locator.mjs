import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {resolveChromeExecutable} from './browser-path.mjs';
import {BOX_LOCATOR_BOARDS,boxLocatorBoard} from '../export/web/box-locator-boards.js';

const out=process.env.KINO_TEST_OUT??'artifacts/v8-box-locator';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json')),checks=[],errors=[];
const markers=data.entities.filter(e=>e.targetname==='magic_box_loc_light');
const power=data.entities.find(e=>e.classname==='trigger_use'&&e.targetname==='use_elec_switch');
const boxes=data.entities.filter(e=>e.targetname==='treasure_chest_use');
const browser=await chromium.launch({headless:true,executablePath:resolveChromeExecutable()});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('requestfailed',r=>errors.push(r.failure()?.errorText+' '+r.url()));
const pass=(name,evidence={})=>{checks.push({name,passed:true,...evidence});console.log('PASS',name);};
const locator=()=>page.evaluate(()=>kino.debug.boxLocatorState());
const state=()=>page.evaluate(()=>kino.debug.getState());
const step=seconds=>page.evaluate(s=>{kino.debug.step(s);return kino.debug.boxLocatorState();},seconds);
async function use(e){return page.evaluate(e=>{kino.debug.teleportPlayer(e.position);kino.debug.step(.05);const probe=kino.debug.interactionProbe(e.id);if(probe.promptId!==e.id)throw new Error('Wrong interaction '+JSON.stringify(probe));return kino.debug.interact();},e);}
async function boardImage(location,label){
  const frame=BOX_LOCATOR_BOARDS.find(b=>b.location===location),board=markers.filter(e=>boxLocatorBoard(e)?.board.location===location),target=new THREE.Vector3(...frame.origin).addScaledVector(new THREE.Vector3(...frame.u),.5).addScaledVector(new THREE.Vector3(...frame.v),.5);
  const camera=target.clone().addScaledVector(new THREE.Vector3(...frame.normal),135),feet=camera.clone();
  feet.y=({alleyway_chest:48,foyer_chest:256,stage_chest:0})[location];camera.y=feet.y+60;
  await page.evaluate(({feet,target})=>{kino.debug.teleportPlayer(feet);kino.debug.lookAt(target);},{feet:feet.toArray(),target:target.clone().add(new THREE.Vector3(0,-20,0)).toArray()});
  const frames=await page.evaluate(()=>kino.debug.memoryState().renderedFrames);
  await page.waitForFunction(frames=>kino.debug.memoryState().renderedFrames>frames+1,frames);
  await page.screenshot({path:path.join(out,label+'.png')});
  return {ids:board.map(e=>e.id),target:target.toArray(),camera:camera.toArray(),actualPlayer:(await state()).player};
}
let final;
try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready||globalThis.kino?.debug.getState().errors.length,null,{timeout:120000});assert.deepEqual(errors,[]);
  await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
  await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.grantPoints(50000);});
  let l=await locator();assert.equal(l.lamps,81);assert.equal(l.batches.length,5);assert.equal(l.lit.length,0);assert.equal(l.addedLights,0);assert(l.groups.every(g=>g.count===9));assert.equal(l.boardRepairs.repositioned,0);assert(l.boardRepairs.decals.materials>0);assert.deepEqual(l.positions.map(e=>e.position),markers.map(e=>e.position));
  const identities=l.batches.map(b=>[b.id,b.geometry,b.material]);pass('81 native marker lamps load in five batches and remain unlit without power',{state:l});
  assert(await use(power));l=await step(.02);assert.equal(l.mode,'selected');assert.equal(l.lit.length,9);
  const selected=await page.evaluate(()=>kino.debug.specialState().boxLocation),box=boxes.find(e=>e.id===selected);
  assert.equal(l.selected,box.script_noteworthy+'_loc');pass('Real power interaction lights the actual active box position on all nine boards',{selected:l.selected});
  await step(5);
  const photos=[];photos.push(await boardImage('alleyway_chest','01-alley-powered'));photos.push(await boardImage('foyer_chest','02-lobby-powered'));photos.push(await boardImage('stage_chest','03-stage-powered'));
  pass('Three native board positions captured for scale/orientation visual review',{photos});

  // Drive the real random box, whose first move is guaranteed by purchase eight.
  let teddy=false;
  for(let i=0;i<8;i++){
    await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);
    assert(await use(box));await step(4.05);
    const special=await page.evaluate(()=>kino.debug.specialState());
    if(special.box?.teddy){teddy=true;break;}
    assert(await use(box));await step(.6);
  }
  assert(teddy,'real box must move by eighth ordinary purchase');l=await locator();assert.equal(l.mode,'moving');
  const samples=await page.evaluate(()=>{const a=[];for(let i=0;i<8;i++){kino.debug.step(.13);a.push(kino.debug.boxLocatorState().lit.length);}return a;});assert(samples.includes(0)&&samples.includes(81));
  pass('Real teddy reveal flashes all locator positions without predicting the hidden roll',{samples});
  await page.evaluate(()=>kino.debug.pause());const paused=await state(),pausedL=await locator();await page.waitForTimeout(350);await step(3);assert.equal((await state()).time,paused.time);assert.deepEqual((await locator()).lit,pausedL.lit);
  pass('Pause freezes box animation and lamp phase');
  await page.evaluate(()=>kino.debug.resume());await step(5.2);l=await locator();const moved=await page.evaluate(()=>kino.debug.specialState().boxLocation);assert.notEqual(moved,selected);assert.equal(l.mode,'selected');assert.equal(l.lit.length,9);assert.equal(l.selected,boxes.find(e=>e.id===moved).script_noteworthy+'_loc');
  pass('Completed relocation updates all nine boards immediately',{old:selected,moved,location:l.selected});
  const sale=await page.evaluate(()=>{kino.debug.collectPowerup('fire_sale');const samples=[];for(let i=0;i<6;i++){kino.debug.step(.16);samples.push(kino.debug.boxLocatorState().lit.length);}return samples;});assert(sale.includes(0)&&sale.includes(81));pass('Real Fire Sale overrides selected location with all-board flashing',{samples:sale});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.pointerLockElement);await page.click('#settings-open');await page.locator('[data-setting="reducedFlashes"]').check();await page.click('#settings-done');await page.evaluate(()=>kino.debug.resume());
  for(let i=0;i<4;i++){l=await step(.2);assert.equal(l.lit.length,81);}await boardImage('alleyway_chest','04-alley-fire-sale-reduced-flashes');pass('Reduced-flash setting holds all sale lamps steadily green');
  await step(31);l=await locator();assert.equal(l.mode,'selected');assert.equal(l.lit.length,9);
  for(let i=0;i<3;i++)await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);kino.debug.step(.03);});
  final=await locator();assert.equal(final.mode,'off');assert.equal(final.lit.length,0);assert.deepEqual(final.batches.map(b=>[b.id,b.geometry,b.material]),identities);
  pass('Sale expiry and repeated restart restore normal/off states without allocating more batches');assert.deepEqual(errors,[]);pass('No script, shader, asset, or network failures');
}catch(e){console.error(e);checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack});await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,final},null,2));await browser.close();}
