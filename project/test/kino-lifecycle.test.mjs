import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KinoSession } from '../export/web/kino-session.js';
import { KinoEvents } from '../export/web/kino-events.js';

const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
const fresh=()=>new KinoSession(data,()=>.5);
const qr='specialty_quickrevive',jug='specialty_armorvest';
const finishDrink=s=>s.update(s.drinkLeft+.01);
const revive=s=>{assert(s.damage(s.maxHealth));assert.equal(s.phase,'reviving');s.update(4.01);s.update(5.01);};
const roll=(events,values)=>{let i=0;events.random=()=>{assert(i<values.length,'unexpected random draw');return values[i++];};return events.chooseRoom();};

test('perk purchases reject invalid, powerless, unaffordable and busy requests without charging',()=>{
  const s=fresh();s.points=10000;
  for(const id of ['unknown',jug,'specialty_rof','specialty_fastreload']){
    assert.equal(s.canBuyPerk(id),false);assert.equal(s.buyPerk(id),false);assert.equal(s.points,10000);assert.equal(s.drinking,null);
  }
  s.points=499;assert(!s.buyPerk(qr));assert.equal(s.points,499);
  s.points=10000;s.power=true;s.equipmentLeft=.2;assert(!s.buyPerk(jug));assert.equal(s.points,10000);
  s.update(.21);s.meleeLeft=.2;assert(!s.buyPerk(jug));assert.equal(s.points,10000);
  s.update(.21);assert(s.buyPerk(jug));assert.equal(s.points,7500);assert(!s.perks.has(jug));
  assert(!s.buyPerk(qr));assert(!s.buyPerk(jug));assert.equal(s.points,7500);
  finishDrink(s);assert(s.perks.has(jug));assert.equal(s.health,250);assert(!s.buyPerk(jug));assert.equal(s.points,7500);
});

test('the third completed Quick Revive purchase retires its machine before the third down',()=>{
  const s=fresh();s.points=1500;
  for(let purchase=1;purchase<=3;purchase++){
    assert(s.canBuyPerk(qr));assert(s.buyPerk(qr));
    assert.equal(s.quickRevivePurchases,purchase-1);finishDrink(s);
    assert.equal(s.quickRevivePurchases,purchase);assert.equal(s.revives,purchase-1);
    assert.equal(s.quickReviveDepleted,purchase===3);assert.equal(s.points,1500-500*purchase);
    if(purchase<3)revive(s);
  }
  assert.equal(s.snapshot().quickReviveDepleted,true);assert(s.perks.has(qr));
  revive(s);assert.equal(s.revives,3);s.points=10000;assert(!s.buyPerk(qr));assert(!s.drink(qr));assert.equal(s.points,10000);
  s.damage(100);assert.equal(s.phase,'gameover');s.reset();
  assert.equal(s.quickRevivePurchases,0);assert.equal(s.quickReviveDepleted,false);assert(s.buyPerk(qr));
});

test('death during the bottle does not grant or count Quick Revive',()=>{
  const s=fresh();assert(s.buyPerk(qr));s.update(s.drinkLeft/2);s.damage(100);s.update(20);
  assert.equal(s.phase,'gameover');assert.equal(s.points,0);assert.equal(s.quickRevivePurchases,0);
  assert.equal(s.drinking,null);assert(!s.perks.has(qr));assert(!s.buyPerk(qr));
});

test('a down interrupts a later perk purchase without granting it after revival',()=>{
  const s=fresh();s.points=10000;s.power=true;assert(s.buyPerk(qr));finishDrink(s);
  assert(s.buyPerk(jug));s.damage(100);assert.equal(s.phase,'reviving');assert.equal(s.points,7000);
  assert.equal(s.drinking,null);s.update(4.01);assert.equal(s.health,100);assert(!s.perks.has(jug));
  assert.equal(s.quickRevivePurchases,1);assert(s.buyPerk(jug));finishDrink(s);assert.equal(s.health,250);
});

test('Pack-a-Punch cannot be claimed while down but remains available after a timely revive',()=>{
  const s=fresh();s.power=true;s.points=5500;assert(s.buyPerk(qr));finishDrink(s);
  assert(s.beginPack());const weapon=s.weapon;s.damage(100);assert(!s.takePack());
  s.update(4.36);assert(s.takePack());assert.equal(s.weapon,weapon);assert(s.weapon.upgraded);
  assert.equal(s.points,0);assert.equal(s.pack,null);
});

test('a finished run clears a pending Pack-a-Punch offer without refunding or returning it',()=>{
  const s=fresh();s.power=true;s.points=5000;assert(s.beginPack());s.update(4.36);
  s.damage(100);assert.equal(s.phase,'gameover');assert.equal(s.pack,null);assert.equal(s.points,0);
  assert.equal(s.lastEvent,'Game over');assert(s.weapon.lost);assert.equal(s.weapon.mag+s.weapon.reserve,0);assert(!s.takePack());
  s.reset();assert(!s.weapon.lost);assert.equal(s.pack,null);assert.equal(s.weapon.id,'m1911_zm');
});

test('Pack-a-Punch times out during a down and cannot be recovered at its expiry boundary',()=>{
  const s=fresh();s.power=true;s.points=5000;s.perks.add(qr);assert(s.beginPack());
  s.update(17);s.damage(100);s.update(2.35);assert.equal(s.phase,'reviving');assert.equal(s.pack,null);
  assert(s.weapon.lost);assert(!s.takePack());s.update(2);assert(s.giveWeapon('mp40_zm'));assert(!s.weapon.lost);
});

test('reacquiring an owned gun after losing another slot refills it without duplicating it',()=>{
  const s=fresh();s.power=true;s.points=5000;s.giveWeapon('mp40_zm');s.switchWeapon(0);
  assert(s.beginPack());s.switchWeapon(1);s.update(20);const lost=s.inventory[0],owned=s.weapon;
  assert(lost.lost);owned.mag=0;owned.reserve=0;assert(s.giveWeapon('mp40_zm'));
  assert.equal(s.inventory[0],lost);assert.equal(s.weapon,owned);assert.equal(s.inventory.filter(w=>w.id==='mp40_zm').length,1);
  assert.equal(owned.mag,32);assert.equal(owned.reserve,192);
  assert(s.giveWeapon('ithaca_zm'));assert.equal(s.inventory[0].id,'ithaca_zm');assert.equal(s.inventory[1],owned);
});

test('the hidden-room drop roll uses the source 66-through-99 integer boundary',()=>{
  const events=new KinoEvents(data,()=>.5);let drops=0;
  for(let value=0;value<100;value++){
    assert(roll(events,[.8,.5,value/100,0,0]));
    const drop=events.consumeRoomPowerup();assert.equal(!!drop,value>=66);if(drop)drops++;
  }
  assert.equal(drops,34);
  assert.equal(roll(events,[.249999]),null);assert.equal(events.consumeRoomPowerup(),null);
  assert(roll(events,[.25,0,.65]));assert.equal(events.consumeRoomPowerup(),null);
});

test('return-room drops retain all seven source outcomes and authored global markers',()=>{
  const events=new KinoEvents(data,()=>.5);
  const types=['nuke','insta_kill','double_points','carpenter','fire_sale','full_ammo','minigun'];
  for(let i=0;i<types.length;i++){
    const room=roll(events,[.8,0,.99,0,(i+.5)/7]);assert.equal(room.targetname,'ee_teleport_player0');
    assert.equal(events.snapshot().roomPowerupChoice,types[i]);
    const drop=events.consumeRoomPowerup();
    if(types[i]==='minigun'){assert.equal(drop,null);continue;}
    assert.equal(drop.type,types[i]);assert.equal(drop.markerId,125);assert.deepEqual(drop.position,[-2600,64,1096]);
    assert.notDeepEqual(drop.position,room.position,'a source roll is not redirected into the visited room');
    assert.equal(events.consumeRoomPowerup(),null,'a staged drop can only be spawned once');
  }
});

test('a new teleport decision or run reset clears an unconsumed room drop',()=>{
  const events=new KinoEvents(data,()=>.5);
  roll(events,[.8,0,.99,0,0]);assert(events.snapshot().roomPowerup);
  const snapshot=events.snapshot();snapshot.roomPowerup.position[0]=999;
  assert.equal(events.snapshot().roomPowerup.position[0],-2600);
  roll(events,[.1]);assert.equal(events.consumeRoomPowerup(),null);assert.equal(events.snapshot().roomPowerupChoice,null);
  roll(events,[.8,0,.99,0,0]);events.random=()=>.5;events.reset();
  assert.equal(events.consumeRoomPowerup(),null);assert.equal(events.snapshot().roomPowerupChoice,null);
});
