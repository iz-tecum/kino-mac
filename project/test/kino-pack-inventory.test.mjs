import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KinoSession, KINO_PACK_RULES } from '../export/web/kino-session.js';

const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
const fresh=()=>{const s=new KinoSession(data,()=>.5);s.power=true;s.points=10000;return s;};

test('deposit selects the other actual carried gun and rejects both direct and cyclic selection of custody',()=>{
  const s=fresh();s.giveWeapon('mp40_zm');const deposited=s.weapon,other=s.inventory[0];
  assert(s.beginPack());assert.equal(s.points,5000);assert.equal(s.pack.weapon,deposited);
  assert.equal(s.weapon,other);assert(!s.weaponUnavailable);assert(!s.switchWeapon(1));assert(!s.switchWeapon());
  assert(!s.beginPack());assert.equal(s.points,5000);assert(!s.giveWeapon(deposited.id));
  s.update(s.fireLeft+.01);const ammo=other.mag;assert(s.fire());assert.equal(other.mag,ammo-1);
  s.update(KINO_PACK_RULES.process);assert(s.takePack());assert.equal(s.weapon,deposited);assert.equal(s.pack,null);
  assert(deposited.upgraded);assert.equal(deposited.mag,data.weapons.mp40_zm.upgrade.clipSize);
  assert.equal(deposited.reserve,data.weapons.mp40_zm.upgrade.maxAmmo);assert.equal(other.mag,ammo-1);
});

test('a sole deposited gun stays unavailable and respects processing and retrieval boundaries',()=>{
  const s=fresh(),w=s.weapon;assert(s.beginPack());assert(s.weaponUnavailable);assert(!s.fire());assert(!s.reload());
  s.update(4.349);assert(!s.takePack());s.update(.001);assert(s.takePack());assert.equal(s.weapon,w);assert(w.upgraded);
  const expired=fresh();assert(expired.beginPack());expired.update(19.35);
  assert.equal(expired.pack,null);assert(expired.weapon.lost);assert(!expired.takePack());assert.equal(expired.points,5000);
});

test('expired custody is not selectable or refilled by Max Ammo, and a real replacement restores the slot',()=>{
  const s=fresh();s.giveWeapon('mp40_zm');const lost=s.weapon,kept=s.inventory[0];assert(s.beginPack());s.update(20);
  assert(lost.lost);assert.equal(s.weapon,kept);assert(!s.switchWeapon(1));assert(!s.switchWeapon());
  kept.reserve=0;s.powerup('full_ammo');assert.equal(lost.mag,0);assert.equal(lost.reserve,0);assert.equal(kept.reserve,data.weapons.m1911_zm.maxAmmo);
  assert(s.giveWeapon('ithaca_zm'));assert.equal(s.inventory.length,2);assert.equal(s.weapon.id,'ithaca_zm');
  assert(s.switchWeapon(0));assert(s.switchWeapon());assert.equal(s.weapon.id,'ithaca_zm');
});

test('downing retains custody while gameover and reset clear it without restoring or refunding the gun',()=>{
  const s=fresh();s.giveWeapon('mp40_zm');const deposited=s.weapon;s.perks.add('specialty_quickrevive');assert(s.beginPack());
  s.damage(100);assert.equal(s.phase,'reviving');assert(!s.takePack());assert.equal(s.pack.weapon,deposited);
  s.update(4.36);assert(s.takePack());assert.equal(s.weapon,deposited);
  s.effects.invulnerable=0;s.damage(100);assert.equal(s.phase,'gameover');assert.equal(s.pack,null);assert.equal(s.points,5000);
  s.reset();assert.equal(s.inventory.length,1);assert.equal(s.weapon.id,'m1911_zm');assert.equal(s.points,500);assert.equal(s.pack,null);
});

test('replacing the fallback gun during processing cannot overwrite the reserved object',()=>{
  const s=fresh();s.giveWeapon('mp40_zm');const deposited=s.weapon;assert(s.beginPack());
  assert(s.giveWeapon('ithaca_zm'));const replacement=s.weapon;assert.notEqual(replacement,deposited);
  assert.equal(s.pack.weapon,deposited);s.update(4.35);assert(s.takePack());assert.equal(s.weapon,deposited);
  assert.equal(s.inventory.filter(w=>w===replacement).length,1);assert.equal(s.inventory.length,2);
});

test('sole deposit can acquire a primary in its free slot and still retrieve the original without duplicates',()=>{
  const s=fresh(),deposited=s.weapon;assert(s.beginPack());assert(s.weaponUnavailable);
  assert(!s.canReceiveWeapon('m1911_zm'));assert(!s.giveWeapon('m1911_zm'));
  assert(s.canReceiveWeapon('mp40_zm'));assert(s.giveWeapon('mp40_zm'));const added=s.weapon;
  assert.equal(s.inventory.length,2);assert.equal(s.pack.weapon,deposited);assert.equal(s.inventory[0],deposited);assert(!s.weaponUnavailable);
  s.update(4.35);assert(s.takePack());assert.equal(s.weapon,deposited);assert(s.weapon.upgraded);assert.equal(s.inventory[1],added);
  assert.equal(new Set(s.inventory).size,2);assert(s.switchWeapon(1));assert.equal(s.weapon,added);
});

test('sole-deposit replacement survives original expiry and reserved full-slot replacement is rejected without mutation',()=>{
  const s=fresh(),deposited=s.weapon;assert(s.beginPack());assert(s.giveWeapon('mp40_zm'));const added=s.weapon;
  // A stale selector cannot make a grant overwrite the machine-owned object.
  s.slot=0;assert(!s.canReceiveWeapon('ithaca_zm'));assert(!s.giveWeapon('ithaca_zm'));assert.equal(s.inventory[0],deposited);
  assert(s.switchWeapon(1));s.update(20);assert.equal(s.pack,null);assert(deposited.lost);assert.equal(s.weapon,added);assert(!s.weaponUnavailable);
  s.powerup('full_ammo');assert.equal(deposited.reserve,0);assert.equal(added.reserve,data.weapons.mp40_zm.maxAmmo);assert(s.fire());
});
