import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,loadSettings,saveSettings,validateSettings,qualitySettings,comfortSettings} from '../export/web/desktop-settings.js';
test('damaged, unavailable, and future settings storage recovers to usable defaults',()=>{
  assert.deepEqual(loadSettings({getItem(){return '{broken';}}),DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings({getItem(){throw new Error('storage denied');}}),DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings({version:2,fov:150}),DEFAULT_SETTINGS);
  assert.doesNotThrow(()=>saveSettings(DEFAULT_SETTINGS,{setItem(){throw new Error('quota exceeded');}}));
});
test('existing v1 choices survive migration while new accessibility and input options use stable defaults',()=>{
  const prior={version:1,quality:'quality',sensitivity:1.75,fov:91,master:32,profile:'reimagined',weaponBob:false};
  const restored=loadSettings({getItem:()=>JSON.stringify(prior)});
  for(const [key,value]of Object.entries(prior))assert.equal(restored[key],value);
  assert.equal(restored.textSize,100);assert.equal(restored.crouchMode,'hold');assert.equal(restored.sprintMode,'hold');assert.equal(restored.wheelSwitch,true);
});
test('Laptop, readable text and accessible input choices survive storage, with unknown values rejected',()=>{
  let saved;
  saveSettings({...DEFAULT_SETTINGS,quality:'laptop',textSize:140,crouchMode:'toggle',sprintMode:'toggle',wheelSwitch:false},{setItem:(_,value)=>saved=value});
  const actual=loadSettings({getItem:()=>saved});assert.equal(actual.quality,'laptop');assert.equal(actual.textSize,140);assert.equal(actual.crouchMode,'toggle');assert.equal(actual.sprintMode,'toggle');assert.equal(actual.wheelSwitch,false);
  const invalid=validateSettings({version:1,textSize:999,crouchMode:'auto',sprintMode:true,wheelSwitch:'false'});
  for(const key of ['textSize','crouchMode','sprintMode','wheelSwitch'])assert.equal(invalid[key],DEFAULT_SETTINGS[key]);
});
test('Comfort is an explicit narrow change preserving graphics, input, audio and rule choices',()=>{
  const before={...DEFAULT_SETTINGS,quality:'quality',fov:93,master:37,crouchMode:'toggle',textSize:140,profile:'reimagined'};
  const after=comfortSettings(before);assert.equal(after.reducedFlashes,true);assert.equal(after.weaponBob,false);assert.equal(after.textSize,140);
  for(const key of Object.keys(before).filter(k=>!['reducedFlashes','weaponBob','textSize'].includes(k)))assert.equal(after[key],before[key]);
  assert.equal(comfortSettings(DEFAULT_SETTINGS).textSize,120);assert.equal(before.reducedFlashes,false);
});
test('saved settings cannot create invalid camera, mixer or profile values',()=>{
  const actual=validateSettings({version:1,fov:900,sensitivity:-1,music:Infinity,master:NaN,invertLook:'yes',quality:'ultra',profile:'infinite-health'});
  assert.equal(actual.fov,105);assert.equal(actual.sensitivity,.25);assert.equal(actual.music,65);assert.equal(actual.master,80);assert.equal(actual.invertLook,false);assert.equal(actual.profile,'classic');assert.equal(actual.quality,'balanced');
  assert(qualitySettings('performance').ratio<qualitySettings('quality').ratio);
});
