import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWindowSize} from '../scripts/window-size.mjs';
test('laptop window fits common work areas rather than forcing a 1440x900 window',()=>{
 for(const [width,height]of [[1280,720],[1440,810],[1512,880],[1920,1080]]){
  const size=initialWindowSize({width,height});assert(size.width<=width-48);assert(size.height<=height-48);assert(size.width>=720);assert(size.height>=480);
 }
 assert.deepEqual(initialWindowSize({width:2560,height:1400}),{width:1440,height:900});
});
test('invalid display data does not generate invalid window dimensions',()=>{
 assert.deepEqual(initialWindowSize({width:NaN,height:0}),{width:1392,height:852});
});
