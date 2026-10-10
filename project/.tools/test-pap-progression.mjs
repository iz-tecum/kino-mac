import { chromium } from 'playwright-core';
import { resolveChromeExecutable } from './browser-path.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out=process.env.KINO_TEST_OUT??'artifacts/v8-gameplay';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json'));
const entity=name=>data.entities.find(e=>e.targetname===name&&e.classname==='trigger_use');
const pad=entity('trigger_teleport_pad_0'),mainframe=entity('pf16_auto1'),pap=entity('zombie_vending_upgrade'),power=entity('use_elec_switch');
const qr=data.entities.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive');
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[],routes=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('requestfailed',r=>errors.push(r.url()+' '+r.failure()?.errorText));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
const state=()=>page.evaluate(()=>kino.debug.getState()),map=()=>page.evaluate(()=>kino.debug.mapState()),features=()=>page.evaluate(()=>kino.debug.completionState());
const step=n=>page.evaluate(n=>kino.debug.step(n),n),pass=(name,evidence={})=>{checks.push({name,passed:true,...evidence});console.log('PASS',name);};
async function ready(){await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(.6);}
async function fresh(){await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.grantPoints(50000);kino.debug.setRoomRandomSequence([0]);});await ready();}
async function use(e){const p=await page.evaluate(id=>kino.debug.interactionProbe(id),e.id);assert.equal(p.promptId,e.id,'visible intended station '+e.targetname+' '+JSON.stringify(p));await page.keyboard.press('KeyF');return state();}
async function station(e){await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.step(.18);},e.position);return use(e);}
async function walk(target,label){
  const start=(await state()).player.feet,route=await page.evaluate(p=>kino.debug.navigationPath(kino.debug.getState().player.feet,p),target);assert(route.length>0,'navigation for '+label);
  let frames=0;
  for(const w of route.slice(1)){
    let reached=false;await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');
    for(let i=0;i<500;i++){
      const s=await state(),p=s.player.feet;if(Math.hypot(p[0]-w[0],p[2]-w[2])<9){reached=true;break;}
      await page.evaluate(w=>{const s=kino.debug.getState();kino.debug.lookAt([w[0],s.player.position[1],w[2]]);kino.debug.step(.025);},w);frames++;
    }
    await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');
    assert(reached,'collision walk '+label+' to '+JSON.stringify(w)+' feet '+JSON.stringify((await state()).player.feet));
  }
  await step(.12);routes.push({label,start,target,route,feet:(await state()).player.feet,acceleratedFrames:frames});
}
async function photo(name,target){if(target)await page.evaluate(p=>kino.debug.lookAt(p),target);await page.screenshot({path:out+'/'+name+'.png'});}
async function linkedTrip(){await station(power);await station(pad);await station(mainframe);await station(pad);await step(2.1);assert((await map()).returnAt>0);}
async function exactPoints(n){const s=await state();await page.evaluate(n=>kino.debug.grantPoints(n),n-s.points);}
async function down(){await page.evaluate(()=>{kino.debug.setInvulnerable(false);kino.debug.damagePlayer(100000);});}

try{
  await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000});await page.click('#start');await fresh();
  assert(await page.evaluate(()=>!!document.pointerLockElement));assert.equal((await state()).profile,'classic');
  // Currency, disabled spawning and invulnerability isolate the route. Every
  // movement below uses W/Shift, native collision and doors; no player teleport.
  for(const [name,target]of [['foyer_top_door',[545,320,641]],['vip_top_door',[1409,320,370]],['dining_room_door',[1444,-16,-850]],['dress_door',[800,-16,-1539]]]){
    await walk(target,name);const d=data.entities.find(e=>e.targetname==='zombie_door'&&e.target===name),before=await state();await use(d);assert((await state()).openDoors.includes(name));assert.equal((await state()).points,before.points-Number(d.zombie_cost));if(name==='foyer_top_door')await walk([650,320,641],'through opened upper door');
  }
  await walk([-488,0,-1246],'power switch');await use(power);assert((await state()).power);pass('Walked from spawn through four paid native doors to restore stage power',{routes:routes.length});
  await walk([-304,0,-1114],'stage link');await use(pad);assert.equal((await state()).teleporter,'linking');
  await walk([2,100,1266],'lobby mainframe');await use(mainframe);assert.equal((await state()).teleporter,'linked');
  await walk([-304,0,-1114],'return to stage pad');await use(pad);assert((await map()).teleportPending>0);await photo('01-stage-countdown',pad.position);await step(2.1);
  assert((await map()).returnAt>0);assert((await state()).player.feet[1]>300);pass('Stage, lobby and stage walk links both pads and the real teleporter reaches projection room',{routes:routes.length,arrival:(await state()).player.feet});
  await walk([7,320,408],'projection machine access');await page.evaluate(()=>kino.debug.giveWeapon('mp40_zm'));await ready();await page.keyboard.press('Digit1');await ready();
  const before=await state();await use(pap);let s=await state();assert.equal(s.points,before.points-5000);assert.equal(s.pack.id,'m1911_zm');assert.equal(s.weapon.id,'mp40_zm');assert(!s.weaponUnavailable);await ready();
  assert.equal((await page.evaluate(()=>kino.debug.weaponVisual())).id,'mp40_zm');await photo('02-processing-fallback',pap.position);
  await page.keyboard.press('Digit1');assert.equal((await state()).weapon.id,'mp40_zm');const paid=s.points;await use(pap);assert.equal((await state()).points,paid);assert((await state()).pack);
  pass('Projection PaP charges exactly 5000, takes custody, equips the other gun and rejects reserved-slot selection',{before:before.points,after:paid});
  await page.evaluate(()=>kino.debug.pause());const paused=await state();await step(10);assert.equal((await state()).time,paused.time);assert.equal((await state()).pack.readyIn,paused.pack.readyIn);await page.evaluate(()=>kino.debug.resume());pass('Pause freezes machine processing and expiry in simulation time');
  await step(4.4);assert((await state()).pack.ready);assert((await features()).packVisible);await photo('03-native-upgraded-offer',pap.position);await use(pap);await ready();s=await state();assert.equal(s.pack,null);assert.equal(s.weapon.name,'Mustang & Sally');assert.equal(s.weapon.mag,12);assert.equal(s.points,paid);assert(!(await features()).packVisible);await photo('04-retrieved-mustang-sally',pap.position);
  pass('Ready native model is visible and F returns the fully loaded upgrade once');
  const afterClaim=s.points;await use(pap);assert.equal((await state()).points,afterClaim);assert(!(await state()).pack);pass('An already upgraded gun is not charged or processed again');
  const returnAt=(await map()).returnAt;await page.keyboard.press('Digit2');await ready();await step(Math.max(0,returnAt-(await state()).time-2));
  await page.keyboard.press('KeyQ');await page.mouse.down();await step(.08);await page.mouse.up();await page.keyboard.press('KeyR');await page.keyboard.down('KeyW');await page.mouse.down();await step(3);
  s=await state();await page.mouse.up();await page.keyboard.up('KeyW');assert(s.player.feet[2]>1000);assert.equal((await map()).returnAt,0);assert(!s.input.ads&&!s.input.aim.keyboardToggled&&!s.input.primary);assert.equal(s.reloadLeft,0);assert.equal(s.meleeLeft,0);pass('Forced return clears aim, held fire/movement and reload rather than continuing them in the lobby',{returnFeet:s.player.feet});
  assert.equal(s.teleporter,'cooldown');const cooling=await map();await step(cooling.cooldownUntil-s.time+.1);assert.equal((await state()).teleporter,'unlinked');pass('Return cooldown ends and the teleporter requires a new two-pad link');

  // Remaining boundary cases deliberately use direct positioning/time/damage.
  await fresh();await station(pap);assert(!(await state()).pack);pass('Unpowered machine rejects deposit');
  await station(power);await exactPoints(4999);await station(pap);assert(!(await state()).pack);assert.equal((await state()).points,4999);pass('4999 points cannot deposit or lose a gun');
  await exactPoints(5000);await page.evaluate(()=>{kino.debug.teleportPlayer([0,100,1120]);kino.debug.step(.1);});await page.keyboard.press('KeyF');assert(!(await state()).pack);assert.equal((await state()).points,5000);pass('A distant keyboard use cannot purchase the projection-room upgrade');
  await station(pap);assert((await state()).weaponUnavailable);assert(!await page.evaluate(()=>kino.debug.shoot()));assert.equal((await state()).points,0);await step(20);s=await state();assert.equal(s.pack,null);assert(s.weapon.lost);assert(!(await features()).packVisible);await page.evaluate(()=>kino.debug.collectPowerup('full_ammo'));s=await state();assert.equal(s.weapon.mag+s.weapon.reserve,0);pass('Unclaimed sole weapon expires, its world model clears and later Max Ammo cannot revive its ammunition');
  await page.evaluate(()=>kino.debug.giveWeapon('mp40_zm'));await ready();assert(!(await state()).weapon.lost);pass('A new weapon replaces the expired inventory slot without a duplicate');

  await fresh();await station(qr);s=await state();await step(s.drinkLeft+.05);await linkedTrip();await station(pap);await down();assert.equal((await state()).phase,'reviving');await page.keyboard.press('KeyF');assert((await state()).pack);await step(4.5);await use(pap);await ready();s=await state();assert(s.weapon.upgraded);assert.equal(s.pack,null);pass('Downing prevents retrieval, but a timely solo revival can still claim the reserved upgrade');
  await fresh();await linkedTrip();await station(pap);await step(4.5);assert((await features()).packVisible);await down();assert.equal((await state()).phase,'gameover');assert.equal((await state()).pack,null);assert(!(await features()).packVisible);pass('Gameover destroys an outstanding offer and its visible world model without refund');
  await fresh();s=await state();assert.equal(s.pack,null);assert(!s.weapon.lost);assert.equal(s.weapon.id,'m1911_zm');assert.equal(s.teleporter,'unlinked');assert.equal((await map()).returnAt,0);assert(!(await features()).packVisible);pass('Restart restores starting inventory and clears all PaP and teleporter timers');
  assert.equal(errors.length,0,errors.join('\n'));pass('All tested progression loaded without script, shader or asset errors');
}catch(e){checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack,state:await state().catch(()=>null),map:await map().catch(()=>null)});console.error(e);process.exitCode=1;await photo('failure').catch(()=>{});}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({method:'Actual Chrome with real Playwright keyboard/mouse interactions. First route walks native collision from spawn through four purchased doors, both linking pads and projection access; nav-guided camera and accelerated simulation, granted currency, disabled spawning and invulnerability are controlled assistance. Secondary MP40 granted for custody regression. Later denial/down/death/expiry cases use labelled direct positioning, damage and time. No human or physical-peripheral play claim.',checks,routes,errors},null,2));await browser.close();}
