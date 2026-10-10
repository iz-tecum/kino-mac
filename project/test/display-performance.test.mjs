import test from 'node:test';
import assert from 'node:assert/strict';
import {displaySettings,GRAPHICS_PRESETS} from '../export/web/display-performance.js';

test('large and Retina displays stay inside their chosen pixel budget without increasing native pixel density',()=>{
  for(const name of Object.keys(GRAPHICS_PRESETS))for(const [width,height]of [[1280,800],[1440,900],[1728,1117],[2560,1440],[3840,2160],[6016,3384]])for(const devicePixelRatio of [.75,1,2,3]){
    const p=displaySettings(name,{width,height,devicePixelRatio});
    assert(p.ratio>0&&p.ratio<=devicePixelRatio&&p.ratio<=GRAPHICS_PRESETS[name].ratio);
    assert(Math.floor(width*p.ratio)*Math.floor(height*p.ratio)<=p.maxPixels,`${name} ${width}x${height} DPR ${devicePixelRatio}`);
  }
});
test('Balanced preserves the current 1440 by 900 Retina presentation, while Laptop deliberately reduces work',()=>{
  const screen={width:1440,height:900,devicePixelRatio:2};
  const balanced=displaySettings('balanced',screen),laptop=displaySettings('laptop',screen);
  assert.equal(balanced.ratio,1.25);assert.equal(balanced.fps,60);
  assert(laptop.ratio<1);assert.equal(laptop.sceneQuality,'performance');assert.equal(laptop.fps,60);
  assert(laptop.ratio**2/balanced.ratio**2<.63);
});
test('display resizing recomputes a stable bounded result without changing the selected preset',()=>{
  const small=displaySettings('quality',{width:1280,height:800,devicePixelRatio:2});
  const large=displaySettings('quality',{width:3456,height:2234,devicePixelRatio:2});
  assert.equal(small.ratio,1.5);assert(large.ratio<1);assert.equal(large.sceneQuality,'quality');assert.equal(large.fps,120);
  assert.deepEqual(displaySettings('quality',{width:1280,height:800,devicePixelRatio:2}),small);
});
test('mobile and invalid display inputs produce finite conservative resolution values',()=>{
  const mobile=displaySettings('quality',{width:1440,height:900,devicePixelRatio:3,mobile:true});
  assert(mobile.ratio<=1);assert.equal(mobile.maxPixels,1000000);assert.equal(mobile.fps,30);
  for(const name of ['unknown','__proto__',undefined])for(const display of [{},{width:0,height:-1,devicePixelRatio:NaN},{width:Infinity,height:NaN,devicePixelRatio:0}]){
    const p=displaySettings(name,display);assert(Number.isFinite(p.ratio)&&p.ratio>0);assert.equal(p.sceneQuality,'balanced');
  }
});
