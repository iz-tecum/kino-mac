import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FramePacer,WheelIntent,reloadPresentation} from '../export/web/input-timing.js';
import {KinoSession} from '../export/web/kino-session.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));

test('frame caps retain their average rate on non-divisible refresh rates',()=>{
  for(const hz of [60,90,120,144,165,240])for(const cap of [30,60,120]){
    const p=new FramePacer(),frames=[];
    for(let i=0;i<hz*10;i++){const t=p.sample(i*1000/hz,cap);if(t)frames.push(t);}
    assert(Math.abs(frames.length-Math.min(hz,cap)*10)<=1,`${hz}Hz / ${cap} cap gave ${frames.length}`);
    assert(frames.every(t=>t.dt>=0&&t.dt<=.06));
  }
});
test('stalls and resume do not create catch-up bursts or sleep-sized simulation steps',()=>{
  const p=new FramePacer();p.sample(0,60);const stall=p.sample(100000,60);
  assert.equal(stall.dt,.06);assert.equal(stall.elapsed,100);assert.equal(p.sample(100001,60),null);
  p.reset();assert.deepEqual(p.sample(200000,60),{elapsed:0,dt:0});
  assert.equal(p.sample(200001,60),null);assert(p.sample(200017,60));
});
test('matching 60 and 120 Hz caps accept alternating early display ticks without dropping half the frames',()=>{
  for(const hz of [60,120]){
    const p=new FramePacer(),accepted=[];
    for(let i=0;i<=hz*5;i++){
      const now=i*1000/hz+(i%2?-.6:0),sample=p.sample(now,hz);
      if(sample)accepted.push(sample);
    }
    assert.equal(accepted.length,hz*5+1,`${hz} Hz must retain all display ticks`);
    assert(Math.abs(accepted.reduce((sum,s)=>sum+s.elapsed,0)-5)<1e-9,'accepted deltas still represent actual elapsed time');
  }
});
test('recorded native RAF jitter is accepted regardless of deadline phase, without uncapping faster displays',()=>{
  // Consecutive lobby RAF intervals 65..104 from the first v1.5 native
  // packaged benchmark, retained in artifacts/v6-pacing-jitter. Rounded to
  // their recorded 0.1 ms precision; the shortest/longest pair is 15.7/17.7.
  const intervals=[16.6,16.7,16.6,16.5,16.9,16.7,16.7,16.6,16.6,15.8,17.6,16.7,16.6,16.6,16.7,16.3,16.4,17.4,16.2,17.1,16.7,16.6,16.7,16.7,16.6,16.7,16.6,16.7,16.7,16.6,16.7,15.7,17.7,16.6,16.7,16.7,16.7,16.6,15.8,17.5];
  for(let phase=0;phase<=16.5;phase+=.25){
    const p=new FramePacer();p.sample(-phase,60);let now=0,count=0;
    for(const dt of intervals){now+=dt;if(p.sample(now,60))count++;}
    assert.equal(count,intervals.length,`native jitter at deadline phase ${phase} ms`);
  }
  for(const hz of [90,120,144,165,240]){
    const p=new FramePacer();let count=0;
    for(let i=0;i<hz*10;i++)if(p.sample(i*1000/hz+(i%2?-.6:0),60))count++;
    assert(Math.abs(count-600)<=1,`${hz} Hz jitter must still honor the 60 FPS cap, got ${count}`);
  }
});
test('trackpad inertia switches once per gesture; horizontal scrolling and pinch do not switch',()=>{
  const w=new WheelIntent();let count=0;
  for(let t=0;t<900;t+=15)count+=Number(w.consume({deltaY:t<100?10:2},t));
  assert.equal(count,1);assert(w.consume({deltaY:100},1100));
  assert(!w.consume({deltaY:120,ctrlKey:true},1400));
  assert(!w.consume({deltaX:130,deltaY:12},1500));
  assert(w.consume({deltaY:-1,deltaMode:1},1600));w.reset();assert(w.consume({deltaY:120},1601));
});
test('switching to the held slot or with one weapon cannot cancel a reload or re-draw the gun',()=>{
  const s=new KinoSession(data);s.weapon.mag=2;assert(s.reload());const left=s.reloadLeft;
  assert.equal(s.switchWeapon(),false);assert.equal(s.reloadLeft,left);
  s.cancelReload();s.giveWeapon('m14_zm');s.weapon.mag=1;assert(s.reload());
  const duration=s.reloadLeft;assert.equal(s.switchWeapon(s.slot),false);assert.equal(s.reloadLeft,duration);
  for(const invalid of [-1,2,.5,NaN])assert.equal(s.switchWeapon(invalid),false);
  assert(s.switchWeapon());assert.equal(s.reloadLeft,0);assert.equal(s.weapon.id,'m1911_zm');
});
test('blocked switching preserves action state; a real switch cancels the old reload',()=>{
  const s=new KinoSession(data);s.giveWeapon('m14_zm');s.meleeLeft=.5;const slot=s.slot;
  assert.equal(s.switchWeapon(),false);assert.equal(s.slot,slot);assert.equal(s.meleeLeft,.5);
});
test('reload indicator follows actual stage timing and ammunition without changing it',()=>{
  const s=new KinoSession(data);s.weapon.mag=2;assert(s.reload());s.update(s.reloadDuration/2);
  const r=reloadPresentation(s);assert.equal(r.progress,.5);assert.equal(r.label,'RELOADING');assert.equal(s.weapon.mag,2);
  s.cancelReload();assert.equal(reloadPresentation(s),null);
  s.giveWeapon('ithaca_zm');s.weapon.mag=1;assert(s.reload());
  assert(reloadPresentation(s).detail.includes('1 /'));
});
