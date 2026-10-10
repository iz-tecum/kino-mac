import test from 'node:test';
import assert from 'node:assert/strict';
import {LaptopInput,acceptsGameKey} from '../export/web/laptop-input.js';
test('keyboard fire is edge triggered, held until release and cleared on input reset',()=>{
 const x=new LaptopInput();assert(x.press('KeyZ'));assert(!x.press('KeyZ'));assert(!x.press('KeyZ',{repeat:true}));assert(x.read(new Set()).fire);x.release('KeyZ');assert(!x.read(new Set()).fire);assert(x.press('KeyZ'));x.clear();assert(!x.read(new Set()).fire);
});
test('toggle crouch ignores repeat; hold crouch and Control remain independent',()=>{
 const x=new LaptopInput(),settings={crouchMode:'toggle'};x.press('KeyC',{settings});x.release('KeyC');assert(x.read(new Set(),settings).crouch);x.press('KeyC',{repeat:true,settings});assert(x.read(new Set(),settings).crouch);x.press('KeyC',{settings});assert(!x.read(new Set(),settings).crouch);assert(x.read(new Set(['ControlLeft']),settings).crouch);assert(x.read(new Set(['KeyC']),{crouchMode:'hold'}).crouch);x.clear();assert(!x.read(new Set(),settings).crouch);
});
test('toggle sprint can be armed before moving but cancels on stopping or reversing',()=>{
 const x=new LaptopInput(),settings={sprintMode:'toggle'};x.press('ShiftLeft',{settings});assert(!x.read(new Set(),settings).sprint);assert(x.read(new Set(['KeyW']),settings).sprint);assert(!x.read(new Set(['KeyW','KeyS']),settings).sprint);assert(!x.read(new Set(['KeyW']),settings).sprint);x.press('ShiftLeft',{settings});assert(x.read(new Set(['KeyW']),settings).sprint);x.clear();assert(!x.read(new Set(['KeyW']),settings).sprint);assert(x.read(new Set(['KeyW','ShiftRight']),{}).sprint);
});
test('menus, editable controls, OS shortcuts and text composition cannot start game actions',()=>{
 assert(acceptsGameKey({code:'KeyW'},true));assert(!acceptsGameKey({code:'Tab'},false));for(const key of ['metaKey','altKey','isComposing'])assert(!acceptsGameKey({[key]:true},true));assert(!acceptsGameKey({target:{closest:()=>({})}},true));
});
