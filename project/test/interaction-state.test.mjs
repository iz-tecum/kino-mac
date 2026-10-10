import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {describeInteraction} from '../export/web/interaction-state.js';
import {KinoSession} from '../export/web/kino-session.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
const make=()=>{const session=new KinoSession(data);return {session,data,doors:new Map(),perks:{specialty_armorvest:{name:'Juggernog',price:2500}},mysteryBox:{at:()=>null,boxes:new Map()},features:{events:{installed:new Set(),carried:null},turrets:[]},traps:{traps:new Map(),rules:{cost:1000}}};};

test('wall ammo presentation follows actual ownership and capacity and never charges points',()=>{
  const ctx=make(),target=data.entities.find(e=>e.zombie_weapon_upgrade==='m14_zm');
  let state=describeInteraction({...ctx,target});assert.equal(state.action,'Buy weapon');assert.equal(state.cost,data.weapons.m14_zm.price);assert(state.available);
  ctx.session.giveWeapon('m14_zm');ctx.session.points=5000;const before=ctx.session.points;
  state=describeInteraction({...ctx,target});assert.equal(state.kind,'ammo');assert(!state.available);assert.equal(state.reason,'Reserve ammo full');assert.equal(ctx.session.points,before);
  ctx.session.weapon.reserve-=2;state=describeInteraction({...ctx,target});assert(state.available);assert.equal(state.action,'Refill ammo');
  ctx.session.weapon.upgraded=true;ctx.session.weapon.reserve=0;state=describeInteraction({...ctx,target});assert.equal(state.cost,4500);assert.equal(state.title,data.weapons.m14_zm.upgrade.name);
  const other=data.entities.find(e=>e.zombie_weapon_upgrade==='mp40_zm');state=describeInteraction({...ctx,target:other});assert.equal(state.detail,'Replaces '+data.weapons.m14_zm.upgrade.name);
});

test('power and owned perk reasons take precedence over an unaffordable price',()=>{
  const ctx=make();ctx.session.points=0;const target={id:1,targetname:'zombie_vending',script_noteworthy:'specialty_armorvest'};
  let state=describeInteraction({...ctx,target});assert(!state.available);assert.equal(state.reason,'Restore the power first');
  ctx.session.power=true;state=describeInteraction({...ctx,target});assert.equal(state.reason,'Not enough points');
  ctx.session.perks.add('specialty_armorvest');state=describeInteraction({...ctx,target});assert.equal(state.reason,'Already equipped');
});

test('Mystery Box and Pack-a-Punch cards expose claim readiness and actual expiry',()=>{
  const ctx=make(),target={id:1,targetname:'treasure_chest_use'},roll={weapon:'m14_zm',ready:false,teddy:false,expires:14};ctx.session.time=4;ctx.mysteryBox.at=()=>roll;
  let state=describeInteraction({...ctx,target});assert(!state.available);assert.equal(state.reason,'Choosing a weapon');assert.equal(state.cost,undefined);
  roll.ready=true;state=describeInteraction({...ctx,target});assert(state.available);assert.equal(state.action,'Take weapon');assert.equal(state.detail,'10 seconds to claim');
  ctx.session.pack={weapon:ctx.session.weapon,readyAt:7,expires:24};const pack={id:2,targetname:'zombie_vending_upgrade'};
  state=describeInteraction({...ctx,target:pack});assert(!state.available);assert.equal(state.detail,'Ready in 3 seconds');
  ctx.session.time=8;state=describeInteraction({...ctx,target:pack});assert(state.available);assert.equal(state.action,'Retrieve weapon');assert.equal(state.detail,'16 seconds to retrieve');
});

test('barrier hold progress is derived from real cooldown/count, and busy states stop the action',()=>{
  const ctx=make(),barrier={id:1,boards:Array(6),count:2},target={barrier};
  let state=describeInteraction({...ctx,target,holding:true,repairLeft:.45});assert.equal(state.count,2);assert.equal(state.total,6);assert(Math.abs(state.progress-.4)<1e-8);assert(state.holding);
  state=describeInteraction({...ctx,target,holding:false,repairLeft:.45});assert.equal(state.progress,0);assert(!state.holding);
  barrier.count=6;state=describeInteraction({...ctx,target,holding:true});assert(!state.available);assert.equal(state.reason,'Barricade secured');
  ctx.session.phase='reviving';barrier.count=2;state=describeInteraction({...ctx,target,holding:true});assert(!state.available);assert(!state.holding);assert.equal(state.reason,'Reviving…');
});
