import test from 'node:test';
import assert from 'node:assert/strict';
import {describeInteraction} from '../export/web/interaction-ui.js';

test('wall weapon card shows the exact price and shortfall without overriding authoritative availability',()=>{
  const poor=describeInteraction({id:1,kind:'weapon',title:'MP40',action:'Buy weapon',cost:1000,points:550,available:false,reason:'Not enough points'});
  assert.equal(poor.category,'WALL WEAPON');assert.equal(poor.price,'1,000 PTS');assert.equal(poor.status,'Need 450 more points');assert(!poor.available);
  const rich=describeInteraction({...poor,points:5000,available:false,reason:'Weapon is in Pack-a-Punch'});assert(!rich.available);assert.equal(rich.status,'Weapon is in Pack-a-Punch');
  const ready=describeInteraction({...poor,points:1000,available:true});assert.equal(ready.shortfall,0);assert.equal(ready.status,'');assert(ready.available);
});

test('unavailable perk reasons take precedence over missing points and zero-cost actions remain explicit',()=>{
  const perk=describeInteraction({kind:'perk',title:'Juggernog',cost:2500,points:0,available:false,reason:'Restore the power first'});assert.equal(perk.status,'Restore the power first');assert.equal(perk.price,'2,500 PTS');
  const power=describeInteraction({kind:'power',title:'Restore the power',cost:0,available:true});assert.equal(power.price,'NO COST');
  const story=describeInteraction({kind:'discovery',title:'Film reel',available:true});assert.equal(story.price,'');assert.equal(story.category,'DISCOVERY');
});

test('repair progress follows the actual board count and only advances while held and available',()=>{
  const input={kind:'repair',title:'Window barricade',available:true,hold:true,holding:true,count:3,total:6,progress:.4};
  const working=describeInteraction(input);assert.equal(working.kind,'barrier');assert.equal(working.count,3);assert.equal(working.progress,.4);assert.equal(working.status,'Rebuilding…');
  const released=describeInteraction({...input,holding:false});assert.equal(released.progress,0);assert.equal(released.count,3);assert.equal(released.status,'Hold to rebuild');
  const complete=describeInteraction({...input,count:6,available:false,reason:'Barricade secured'});assert.equal(complete.progress,0);assert.equal(complete.count,6);assert.equal(complete.status,'Barricade secured');
  const busy=describeInteraction({...input,available:false,reason:'Reviving…'});assert.equal(busy.progress,0);assert(!busy.holding);assert.equal(busy.status,'Reviving…');
});

test('ammunition and touch interaction use their own labels and malformed targets hide cleanly',()=>{
  const ammo=describeInteraction({kind:'ammo',title:'MP40',available:true,action:'Refill ammo',key:'USE',cost:500,points:900});assert.equal(ammo.category,'AMMUNITION');assert.equal(ammo.key,'USE');assert.equal(ammo.action,'Refill ammo');
  assert.equal(describeInteraction(null),null);assert.equal(describeInteraction({title:''}),null);assert.equal(describeInteraction({title:'  '}),null);
  const values=describeInteraction({kind:'barrier',title:'Window',available:true,holding:true,total:6,count:-1,progress:Infinity,cost:NaN});assert.equal(values.count,0);assert.equal(values.progress,0);assert.equal(values.cost,null);
});
