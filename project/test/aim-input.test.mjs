import test from 'node:test';
import assert from 'node:assert/strict';
import {AimInput} from '../export/web/aim-input.js';

test('Q toggles once per press; releases, held repeats and duplicate down events cannot flip it',()=>{
  const aim=new AimInput();assert(aim.press());assert(aim.read());
  for(let i=0;i<20;i++)assert(!aim.press({repeat:true}));assert(!aim.press());assert(aim.read());
  aim.release();assert(aim.read());assert(aim.press());assert(!aim.read());aim.release();
});
test('mouse hold and keyboard toggle remain independent in both release orders',()=>{
  const aim=new AimInput();aim.press();aim.release();aim.setMouse(true);aim.setMouse(false);assert(aim.read());
  aim.setMouse(true);aim.press();aim.release();assert(!aim.keyboardToggled);assert(aim.read());
  aim.setMouse(false);assert(!aim.read());
});
test('touch aim remains a separate source and cannot erase the keyboard toggle',()=>{
  const aim=new AimInput();assert(aim.read(true));assert(!aim.read(false));
  aim.press();aim.release();assert(aim.read(false));aim.press();aim.release();assert(aim.read(true));
});
test('clear removes held and toggled state; an auto-repeat after resume cannot re-enable it',()=>{
  const aim=new AimInput();aim.press();aim.setMouse(true);aim.clear();
  assert.deepEqual(aim.snapshot(),{keyboardToggled:false,mouseHeld:false});assert(!aim.read());
  assert(!aim.press({repeat:true}));assert(!aim.read());aim.release();assert(aim.press());assert(aim.read());
});
test('inactive or modified shortcut presses cannot toggle or consume the next permitted press',()=>{
  const aim=new AimInput();assert(!aim.press({allowed:false}));assert(!aim.read());
  assert(aim.press());aim.release();assert(!aim.press({allowed:false}));assert(aim.read());
});
