import { resolveChromeExecutable } from './browser-path.mjs';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Browser acceptance: controlled positioning, damage and simulation time; all
// purchases use the normal keyboard interaction path and actual map occlusion.
const root=path.resolve(new URL('..',import.meta.url).pathname);
const out=path.resolve(process.env.KINO_TEST_OUT??path.join(root,'artifacts/map-lifecycle'));
fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'export/web/game-data.json'),'utf8'));
const target=name=>data.entities.find(e=>e.targetname===name&&['trigger_use','trigger_use_touch'].includes(e.classname));
const perk=id=>data.entities.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy===id);
const qr=perk('specialty_quickrevive'),pad=target('trigger_teleport_pad_0'),lobbyPad=target('pf16_auto1');
const checks=[],errors=[],requests=[];
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
const page=await context.newPage();
page.on('pageerror',e=>errors.push({kind:'script',message:String(e)}));
page.on('console',m=>{if(m.type()==='error')errors.push({kind:'console',message:m.text()});});
page.on('requestfailed',r=>errors.push({kind:'request',url:r.url(),message:r.failure()?.errorText}));
page.on('response',r=>{if(r.status()>=400)errors.push({kind:'http',url:r.url(),status:r.status()});});
page.on('request',r=>{if(/^https?:/.test(r.url())&&!['127.0.0.1','localhost'].includes(new URL(r.url()).hostname))requests.push(r.url());});
const state=()=>page.evaluate(()=>kino.debug.getState());
const map=()=>page.evaluate(()=>kino.debug.mapState());
const features=()=>page.evaluate(()=>kino.debug.completionState());
const special=()=>page.evaluate(()=>kino.debug.specialState());
const step=seconds=>page.evaluate(seconds=>kino.debug.step(seconds),seconds);
const pass=(name,evidence={})=>{checks.push({name,passed:true,...evidence});console.log('PASS',name);};
const move=position=>page.evaluate(position=>kino.debug.teleportPlayer(position),position);
async function ready(){await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(.5);}
async function fresh(){
  await page.evaluate(()=>{kino.debug.setRoomRandomSequence([]);kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.grantPoints(20000);kino.debug.teleportPlayer([0,100,1120]);});
  await ready();
}
async function use(entity){
  assert(entity,'authored interaction exists');
  await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.step(.15);},entity.position);
  const probe=await page.evaluate(id=>kino.debug.interactionProbe(id),entity.id);
  assert.equal(probe.promptId,entity.id,'correct visible interaction selected: '+entity.targetname);
  await page.keyboard.press('KeyF');
  return state();
}
async function finishDrink(){const s=await state();assert(s.drinking,'bottle action started');await step(s.drinkLeft+.1);assert(!(await state()).drinking,'bottle action completed');}
async function power(){await use(target('use_elec_switch'));assert((await state()).power,'power enabled');}
async function damage(){await page.evaluate(()=>{kino.debug.setInvulnerable(false);kino.debug.damagePlayer(100000);});}
async function screenshot(name){await page.screenshot({path:path.join(out,name+'.png')});}
async function qrView(){await page.evaluate(()=>{kino.debug.teleportPlayer([440,80,1260]);kino.debug.lookAt([531,108,1261]);});await step(.1);}

try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');
  await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000});
  await page.click('#start');
  await page.waitForFunction(()=>kino.debug.getState().active);
  assert(await page.evaluate(()=>!!document.pointerLockElement),'normal start captures pointer');
  await fresh();

  // Depletion is a completed-grant count, with the third life still owned.
  await qrView();await screenshot('quick-revive-before');
  for(let purchase=1;purchase<=3;purchase++){
    const before=await state();await use(qr);const drinking=await state();
    assert.equal(drinking.points,before.points-500);assert.equal(drinking.quickRevivePurchases,purchase-1);
    assert(!drinking.perks.includes('specialty_quickrevive'));
    await finishDrink();const granted=await state(),visual=await map();
    assert(granted.perks.includes('specialty_quickrevive'));assert.equal(granted.quickRevivePurchases,purchase);
    assert.equal(granted.quickReviveDepleted,purchase===3);
    assert.equal(visual.quickReviveVisible,purchase<3);assert.equal(visual.reviveCollision,purchase<3);
    pass('Quick Revive completed purchase '+purchase+' synchronizes grant, model and collision',{purchases:granted.quickRevivePurchases,visible:visual.quickReviveVisible,collision:visual.reviveCollision});
    if(purchase<3){await damage();assert.equal((await state()).phase,'reviving');await step(4.2);assert.notEqual((await state()).phase,'reviving');assert(!(await state()).perks.includes('specialty_quickrevive'));}
  }
  await qrView();await screenshot('quick-revive-depleted');
  const depletedPoints=(await state()).points;await page.keyboard.press('KeyF');assert.equal((await state()).points,depletedPoints);
  await fresh();assert.equal((await state()).quickRevivePurchases,0);assert.equal((await map()).quickReviveVisible,true);assert.equal((await map()).reviveCollision,true);
  pass('Restart restores Quick Revive model, collision and purchase count');

  await use(qr);assert((await special()).drink);await damage();
  const canceled=await state();assert.equal(canceled.phase,'gameover');assert(!canceled.drinking);assert.equal(canceled.quickRevivePurchases,0);assert(!canceled.perks.includes('specialty_quickrevive'));assert.equal((await special()).drink,null);
  assert.equal((await map()).quickReviveVisible,true);assert.equal((await map()).reviveCollision,true);
  pass('Lethal damage during the first bottle cancels its grant and does not count a purchase');

  await fresh();await power();
  await page.evaluate(()=>{kino.debug.teleportPlayer([-101,108,1256]);kino.debug.step(.15);});
  const outsideProbes=await page.evaluate(ids=>ids.map(id=>({id,...kino.debug.interactionProbe(id)})),data.entities.filter(e=>e.targetname==='zombie_vending').map(e=>e.id));
  assert(outsideProbes.every(p=>p.distance>115),'all perk machines are beyond interaction range');
  const outsideBefore=await state();await page.keyboard.press('KeyF');const outsideAfter=await state();assert.equal(outsideAfter.points,outsideBefore.points);assert(!outsideAfter.drinking);assert.equal(outsideAfter.perks.length,0);
  pass('All four perk machines reject an out-of-range keyboard purchase',{probes:outsideProbes});

  // Search authored machine surroundings for a grounded, near but occluded
  // camera position; the exact wall sample is recorded rather than presumed.
  const blocked=await page.evaluate(entities=>{
    for(const e of entities)for(const yOffset of [-40,-20,0])for(const radius of [80,100,60])for(let i=0;i<16;i++){
      const theta=i*Math.PI/8,p=[e.position[0]+Math.cos(theta)*radius,e.position[1]+yOffset,e.position[2]+Math.sin(theta)*radius];
      kino.debug.teleportPlayer(p);kino.debug.step(.25);
      const probe=kino.debug.interactionProbe(e.id),s=kino.debug.getState();
      if(s.player.grounded&&probe.distance<110&&!probe.clear&&probe.promptId===null)return {id:e.id,perk:e.script_noteworthy,requestedFeet:p,feet:s.player.feet,probe};
    }
    return null;
  },data.entities.filter(e=>e.targetname==='zombie_vending'));
  assert(blocked,'a grounded near-wall rejection sample exists');
  const wallBefore=await state();await page.keyboard.press('KeyF');const wallAfter=await state();assert.equal(wallAfter.points,wallBefore.points);assert(!wallAfter.drinking);assert.equal(wallAfter.perks.length,0);
  await screenshot('occluded-perk');pass('A wall blocks a grounded, in-range perk purchase',{sample:blocked});

  await fresh();await power();await use(qr);await finishDrink();
  await use(pad);assert.equal((await state()).teleporter,'linking');await use(lobbyPad);assert.equal((await state()).teleporter,'linked');
  await use(pad);assert((await map()).teleportPending>0);await move([0,100,1120]);await step(2.3);
  assert.equal((await map()).teleportPending,0);assert.equal((await map()).returnAt,0);assert.equal((await state()).teleporter,'linked');assert((await state()).player.feet[2]>1000);
  pass('Leaving the authored pad cancels the pending teleport without consuming the link');
  await use(pad);assert((await map()).teleportPending>0);await damage();assert.equal((await state()).phase,'reviving');await step(.1);assert.equal((await map()).teleportPending,0);assert.equal((await map()).returnAt,0);await step(4.2);assert.equal((await state()).teleporter,'linked');
  pass('Being downed on the pad cancels teleport before solo revival');
  await page.evaluate(()=>kino.debug.setInvulnerable(true));await use(pad);await step(2.2);
  assert.equal((await state()).teleporter,'cooldown');assert((await state()).player.feet[1]>300);assert((await map()).returnAt>(await state()).time);assert.equal((await map()).teleportPending,0);
  await screenshot('projection-room');pass('Staying on the linked pad completes the normal projection-room trip');

  await page.evaluate(()=>kino.debug.setRoomRandomSequence([.8,0,.99,0,.34]));
  const room=data.entities.find(e=>/^ee_teleport_player[0-3]$/.test(e.targetname)),marker=data.entities.find(e=>e.targetname==='struct_random_powerup_post_teleport');
  await step((await map()).returnAt-(await state()).time+.15);
  const roomState=await features(),drops=(await special()).pickups;
  assert.equal(roomState.events.room,room.targetname);assert.equal(roomState.events.roomPowerupChoice,'double_points');assert.equal(roomState.events.roomPowerup,null);assert.equal(drops.length,1);assert.equal(drops[0].type,'double_points');
  assert.deepEqual(drops[0].position,marker.position.map((n,i)=>n+(i===1?40:0)));
  await step(1);assert.equal((await special()).pickups.length,1);await screenshot('hidden-room');
  await step(6);assert.equal((await features()).events.room,null);assert.equal((await special()).pickups.length,1);assert((await state()).player.feet[2]>1000);assert((await map()).cooldownUntil>(await state()).time);
  pass('A deterministic hidden-room return spawns its global-marker drop exactly once, then returns to lobby',{room:room.targetname,markerId:marker.id,drop:drops[0]});

  await fresh();assert.equal((await special()).pickups.length,0);assert.equal((await features()).events.room,null);assert.equal((await map()).returnAt,0);assert.equal((await map()).cooldownUntil,0);
  await power();await use(target('zombie_vending_upgrade'));assert((await state()).pack);assert((await state()).weaponUnavailable);await step(4.6);assert((await state()).pack.ready);assert.equal((await features()).packVisible,true);
  await screenshot('pack-ready');await damage();assert.equal((await state()).phase,'gameover');assert.equal((await state()).pack,null);assert.equal((await features()).packVisible,false);assert.equal((await map()).teleportPending,0);assert(!await page.evaluate(()=>kino.debug.interact()));
  pass('Game over removes the ready Pack-a-Punch model and reserved weapon claim');

  await fresh();assert.equal((await features()).packVisible,false);assert.equal((await state()).pack,null);assert.equal((await state()).quickRevivePurchases,0);assert.equal((await special()).pickups.length,0);
  assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(requests.length,0,'runtime makes no external requests');
  pass('Fresh restart clears all tested lifecycle state with no browser or asset errors');
}catch(error){
  console.error(error);process.exitCode=1;
  checks.push({name:'Failure',passed:false,error:String(error),stack:error.stack,state:await state().catch(()=>null),map:await map().catch(()=>null),features:await features().catch(()=>null),special:await special().catch(()=>null)});
  await screenshot('failure').catch(()=>{});
}finally{
  await page.evaluate(()=>{kino.debug.setRoomRandomSequence([]);kino.debug.reset();kino.debug.setActive(false);}).catch(()=>{});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({method:'Isolated Chrome context; normal start and keyboard purchases; debug positioning, damage, controlled room RNG and accelerated simulation time.',checks,errors,externalRequests:requests},null,2));
  await context.close();await browser.close();
}
