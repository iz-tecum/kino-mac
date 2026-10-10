import {chromium} from 'playwright-core';
import {resolveChromeExecutable} from './browser-path.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const out=process.env.KINO_TEST_OUT??'artifacts/v8-pap-empty-slot';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json'));
const entity=name=>data.entities.find(e=>e.targetname===name&&e.classname==='trigger_use');
const pap=entity('zombie_vending_upgrade'),pad=entity('trigger_teleport_pad_0'),mainframe=entity('pf16_auto1'),power=entity('use_elec_switch');
const wall=data.entities.find(e=>e.zombie_weapon_upgrade==='m14_zm');
const browser=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const state=()=>page.evaluate(()=>kino.debug.getState()),map=()=>page.evaluate(()=>kino.debug.mapState()),special=()=>page.evaluate(()=>kino.debug.specialState());
const step=n=>page.evaluate(n=>kino.debug.step(n),n),pass=(name,evidence)=>{checks.push({name,passed:true,evidence});console.log('PASS',name);};
async function ready(){await page.waitForFunction(()=>kino.debug.getState().viewmodelReady);await step(1.6);}
async function use(e){await page.evaluate(p=>{kino.debug.teleportPlayer(p);kino.debug.step(.15);},e.position);const p=await page.evaluate(id=>kino.debug.interactionProbe(id),e.id);assert.equal(p.promptId,e.id);await page.keyboard.press('KeyF');}
async function lateDeposit(){
 await page.evaluate(()=>{kino.debug.reset();kino.debug.setActive(true);kino.debug.setInvulnerable(true);kino.debug.setAutoSpawn(false);kino.debug.grantPoints(20000);kino.debug.setRoomRandomSequence([0]);});await ready();
 await use(power);await use(pad);await use(mainframe);await use(pad);await step(2.1);assert((await map()).returnAt>0);
 const m=await map(),s=await state();await step(m.returnAt-s.time-1.2);const before=(await state()).points;await use(pap);assert.equal((await state()).points,before-5000);assert((await state()).weaponUnavailable);
 await step(1.5);const returned=await state();assert.equal((await map()).returnAt,0);assert(returned.player.feet[2]>1000);assert(returned.pack);assert(returned.weaponUnavailable);return returned;
}
async function buyWall(){const before=(await state()).points;await use(wall);await ready();const s=await state();assert.equal(s.points,before-data.weapons.m14_zm.price);assert.equal(s.weapon.id,'m14_zm');assert(!s.weaponUnavailable);assert.equal(s.inventory.length,2);assert.equal(s.pack.id,'m1911_zm');return s;}
try{
 await page.goto(process.env.KINO_URL??'http://127.0.0.1:5173/');await page.waitForFunction(()=>globalThis.kino?.debug.getState().ready,null,{timeout:180000});await page.click('#start');
 const returned=await lateDeposit();pass('A late sole-gun deposit is still held by the machine when Classic forces the actual return',{pack:returned.pack,feet:returned.player.feet});
 const bought=await buyWall();assert(await page.evaluate(()=>kino.debug.shoot()));pass('Wall purchase after forced return charges once and equips a usable M14 in the free slot',{inventory:bought.inventory,pack:bought.pack});
 await step((await state()).pack.expiresIn+.1);let s=await state();assert.equal(s.pack,null);assert.equal(s.weapon.id,'m14_zm');assert(s.inventory.find(w=>w.id==='m1911_zm').lost);assert(!s.weaponUnavailable);await page.evaluate(()=>kino.debug.collectPowerup('full_ammo'));s=await state();assert.equal(s.inventory[0].reserve,0);assert(s.weapon.reserve>0);pass('Expiry loses only the original reserved gun; the purchased primary and its ammo remain usable');
 await lateDeposit();await buyWall();await step(3);assert((await state()).pack.ready);
 // Direct reposition is deliberate here: a legitimate second teleporter visit
 // cannot finish before the outstanding offer expires. This isolates custody.
 await use(pap);await ready();s=await state();assert.equal(s.pack,null);assert(s.weapon.upgraded);assert.equal(s.weapon.id,'m1911_zm');assert.equal(s.inventory.length,2);assert.equal(s.inventory.filter(w=>w.id==='m14_zm').length,1);await page.keyboard.press('Digit2');await ready();assert.equal((await state()).weapon.id,'m14_zm');pass('Controlled timely reaccess retrieves the original upgrade without replacing or duplicating the new primary');
 await lateDeposit();let sp=await special();const box=data.entities.find(e=>e.id===sp.boxLocation);assert(box);const before=(await state()).points;await use(box);assert.equal((await state()).points,before-950);await step(4.1);sp=await special();const offer=sp.boxes.find(b=>b.id===box.id).roll;assert(offer?.ready&&!offer.teddy);
 await use(box);await ready();s=await state();assert.equal(s.points,before-950);assert.equal(s.pack.id,'m1911_zm');assert.equal((await special()).boxes.find(b=>b.id===box.id).roll,null);
 if(offer.weapon==='zombie_cymbal_monkey'){assert(s.monkeysOwned);assert.equal(s.monkeys,3);pass('Box equipment offer remains collectible during sole-gun custody',{offer:offer.weapon});}
 else{assert.equal(s.weapon.id,offer.weapon);assert(!s.weaponUnavailable);assert.equal(s.inventory.length,2);pass('Box weapon offer can occupy the free primary slot without losing machine custody',{offer:offer.weapon,inventory:s.inventory});}
 await page.screenshot({path:out+'/box-custody.png'});assert.equal(errors.length,0,errors.join('\n'));pass('The accepted wall and box acquisitions produced no script, shader or asset errors');
}catch(e){checks.push({name:'Failure',passed:false,error:String(e),stack:e.stack,state:await state().catch(()=>null)});console.error(e);process.exitCode=1;await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{fs.writeFileSync(out+'/report.json',JSON.stringify({method:'Actual Chrome keyboard F purchases through native prompts. Currency, invulnerability, disabled spawning, direct positioning and accelerated time are explicit fixtures. Actual two-pad teleport/forced return is used; one direct return to PaP isolates otherwise-unreachable timely custody retrieval. A random first Mystery Box offer is preserved, not injected.',checks,errors},null,2));await browser.close();}
