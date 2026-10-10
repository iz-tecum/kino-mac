import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session } from '../export/web/rules.js';
import { KinoSession } from '../export/web/kino-session.js';
import { GAME_PROFILES } from '../export/web/game-profiles.js';

const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
const fresh=(profile='reimagined')=>new KinoSession(data,()=>.5,{profile});
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const jug=s=>{s.perks.add('specialty_armorvest');s.health=250;return s;};

test('Classic remains the default and retains the existing Session recovery',()=>{
  const plain=new Session(data,()=>.5),kino=new KinoSession(data,()=>.5);
  assert.equal(kino.profile.id,'classic');
  for(const s of [plain,kino]){s.damage(50);s.update(4);assert.equal(s.health,50);s.update(.2);assert.equal(s.health,55);}
  for(const s of [plain,kino]){jug(s);s.damage(200);s.update(4);assert.equal(s.health,50);s.update(.2);assert.equal(s.health,62.5);}
  assert.equal(kino.snapshot().profileLabel,'Classic reconstruction');
});

test('profiles are frozen and a new selection takes effect only on reset',()=>{
  let calls=0;
  const s=new KinoSession(data,()=>{calls++;return .5;},{profile:'reimagined'});
  assert.equal(calls,1,'selecting a profile must not reroll the initial dog round');
  assert(Object.isFrozen(GAME_PROFILES));assert(Object.isFrozen(s.profile));assert(Object.isFrozen(s.profile.recovery));
  assert.throws(()=>{s.profile.recovery.healthPerSecond=1000;},TypeError);
  s.damage(50);s.setProfile('classic');s.update(2.25);near(s.health,75);
  assert.equal(s.snapshot().profile,'reimagined');assert.equal(s.snapshot().profileLabel,'Reimagined recovery');
  s.reset();assert.equal(s.profile.id,'classic');s.damage(50);s.update(2.25);assert.equal(s.health,50);
  assert.throws(()=>s.setProfile('full-mod'),RangeError);
  s.reset();assert.equal(s.profile.id,'classic');
});

test('normal recovery starts after two seconds and restores 100 absolute HP per second',()=>{
  const s=fresh();s.damage(50);s.update(2);assert.equal(s.health,50);
  s.update(.1);near(s.health,60);s.update(.4);near(s.health,100);s.update(1);assert.equal(s.health,100);
  const armored=jug(fresh());armored.damage(125);armored.update(2);assert.equal(armored.health,125);
  armored.update(.5);near(armored.health,175);armored.update(.75);near(armored.health,250);
});

test('exactly 20 percent health uses the four-second delay with and without Juggernog',()=>{
  for(const maxHealth of [100,250]){
    const critical=maxHealth===250?jug(fresh()):fresh();
    critical.damage(maxHealth*.8);critical.update(3.9);near(critical.health,maxHealth*.2);
    critical.update(.1);near(critical.health,maxHealth*.2);critical.update(.1);near(critical.health,maxHealth*.2+10);
    const above=maxHealth===250?jug(fresh()):fresh();
    above.damage(maxHealth*.8-.001);above.update(2);near(above.health,maxHealth*.2+.001);
    above.update(.1);near(above.health,maxHealth*.2+10.001);
  }
});

test('a critical hit keeps its delay while recovery passes the critical threshold',()=>{
  const s=fresh();s.damage(80);s.update(4.1);near(s.health,30);
  s.update(.1);near(s.health,40);s.update(.1);near(s.health,50);
  // A new hit starts a new delay based on the resulting health.
  s.damage(5);s.update(2);near(s.health,45);s.update(.1);near(s.health,55);
  s.damage(40);s.update(3.9);near(s.health,15);s.update(.1);near(s.health,15);s.update(.1);near(s.health,25);
});

test('Quick Revive divides both delays by 1.25 without multiplying the healing rate',()=>{
  for(const [damage,delay,remaining] of [[50,1.6,50],[80,3.2,20]]){
    const s=fresh();s.perks.add('specialty_quickrevive');s.damage(damage);
    s.update(delay);near(s.health,remaining);s.update(.1);near(s.health,remaining+10);
  }
  const s=jug(fresh());s.perks.add('specialty_quickrevive');s.damage(200);
  s.update(3.2);near(s.health,50);s.update(.5);near(s.health,100);
});

test('zero, negative and invalid damage cannot heal or postpone Reimagined recovery',()=>{
  const s=fresh();s.damage(50);s.update(1.5);const before=s.snapshot();
  for(const value of [0,-10,NaN,Infinity,-Infinity])assert.equal(s.damage(value),false);
  assert.deepEqual(s.snapshot(),before);s.update(.75);near(s.health,75);
});

test('Classic retains legacy damage handling instead of silently changing shared rules',()=>{
  const plain=new Session(data,()=>.5),kino=fresh('classic');
  for(const s of [plain,kino]){s.damage(50);s.update(2);s.damage(0);s.damage(-5);s.update(2.1);}
  assert.equal(kino.health,plain.health);assert.equal(kino.damageTime,plain.damageTime);
  assert.equal(kino.health,55);
});

test('paused or invalid delta time does not advance recovery or other run timers',()=>{
  const s=fresh();s.damage(50);s.update(1.5);s.weapon.mag--;s.reload();s.equipmentLeft=.8;
  const before=s.snapshot(),damageTime=s.damageTime,countdown=s.countdown;
  for(const dt of [0,0,0,-1,NaN,Infinity])s.update(dt);
  assert.deepEqual(s.snapshot(),before);assert.equal(s.damageTime,damageTime);assert.equal(s.countdown,countdown);
  s.update(.75);near(s.health,75);
});

test('recovery agrees across different frame sizes and never credits the waiting interval',()=>{
  const large=fresh(),small=fresh();large.damage(70);small.damage(70);
  large.update(2.25);for(let i=0;i<9;i++)small.update(.25);
  near(large.health,55);near(small.health,55);
  const critical=jug(fresh());critical.damage(200);critical.update(4.5);near(critical.health,100);
});

test('death and revive phases do not recover health, and invulnerability cannot reset recovery',()=>{
  const dead=fresh();dead.damage(100);dead.update(10);assert.equal(dead.health,0);assert.equal(dead.time,0);
  const s=fresh();s.perks.add('specialty_quickrevive');s.damage(100);s.update(3.5);
  assert.equal(s.health,0);assert.equal(s.phase,'reviving');s.update(.5);assert.equal(s.health,100);
  const damageTime=s.damageTime;assert.equal(s.damage(50),false);assert.equal(s.damageTime,damageTime);
  s.update(5.1);s.damage(50);s.update(2);assert.equal(s.health,50);s.update(.1);near(s.health,60);
});

test('the recovery option preserves wave, score, weapon and perk purchase rules',()=>{
  const classic=fresh('classic'),reimagined=fresh();
  for(const s of [classic,reimagined]){s.scoreHit(true,true);s.giveWeapon('mp40_zm');s.nextRound();}
  for(const key of ['points','round','total','countdown','nextDogRound'])assert.equal(reimagined[key],classic[key],key);
  assert.deepEqual(reimagined.inventory,classic.inventory);assert.deepEqual([...reimagined.perks],[...classic.perks]);
});
