import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildSurfaceIndex } from '../.tools/build-surface-index.mjs';
import { SurfaceIndex, SURFACE_CLASSES, baseMaterialName, classifySurface } from '../export/web/surface-index.js';
import { deserializeCollisionWorld } from '../export/web/collision-world.js';

const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const positions=new Float32Array([0,0,0,10,0,0,0,0,10]),indices=new Uint32Array([0,1,2]);
  const buffer=Buffer.concat([Buffer.from(positions.buffer),Buffer.from(indices.buffer)]);
  const names=['*1(wc/mtl_theater_carpet_1:wc/glo_dec_blood_pool)','wc/eb_art_floor_wood_core','wc/sky_day','wc/udr_floor_metal_rivets'];
  const meshes=names.map((_,material)=>({primitives:[{attributes:{POSITION:0},indices:1,material}]}));
  const doc={accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5125,type:'SCALAR',count:3}],bufferViews:[{byteOffset:0,byteLength:36},{byteOffset:36,byteLength:12}],materials:names.map(name=>({name})),meshes,nodes:[
    {mesh:0,translation:[10,2,30]},
    {mesh:1,matrix:new THREE.Matrix4().makeTranslation(20,2,30).toArray()},
    {mesh:2,translation:[0,0,0]},
    {mesh:3,translation:[-2500,50,1200]},
    {mesh:3,translation:[5000,0,0]},
    {mesh:0,translation:[0,0,0],extras:{dynamicBrush:true}},
  ]};
  // Deliberately reorder triangles, as the BVH does, but retain vertex order.
  const expected=new Float32Array([10,2,30,20,2,30,10,2,40,20,2,30,30,2,30,20,2,40,-2500,50,1200,-2490,50,1200,-2500,50,1210]);
  const reordered=new Uint32Array([6,7,8,0,1,2,3,4,5]);
  const collision=Buffer.concat([Buffer.from(expected.buffer),Buffer.from(reordered.buffer)]);
  const metadata={vertices:9,triangles:3,layout:{position:{type:'Float32Array',byteOffset:0,byteLength:expected.byteLength,count:expected.length},index:{type:'Uint32Array',byteOffset:expected.byteLength,byteLength:reordered.byteLength,count:reordered.length}}};
  return {doc,buffer,collision,metadata,data:{entities:[{targetname:'ee_teleport_player2',position:[-2500,50,1200]}]}};
}

test('structural material classification ignores model prefixes and decorative compound layers',()=>{
  assert.equal(baseMaterialName('*17(wc/eb_art_floor_wood_core:wc/decal_concrete_crack)'),'wc/eb_art_floor_wood_core');
  assert.equal(classifySurface('*17(wc/eb_art_floor_wood_core:wc/decal_concrete_crack)'),'wood');
  assert.equal(classifySurface('*20(wc/mtl_theater_carpet_2:wc/glo_dec_blood_pool)'),'carpet');
  assert.equal(classifySurface('metal_prop:mc/mtl_carpet'),'carpet');
  assert.equal(classifySurface('wc/eb_dec_cloth_runner_mid'),'carpet');
  assert.equal(classifySurface('wc/zombie_floors_metal_catwalk1'),'metal');
  assert.equal(classifySurface('wc/rus_gantry_generic'),'metal');
  assert.equal(classifySurface('wc/glo_dirt_burnt'),'dirt');
  assert.equal(classifySurface('wc/eb_art_floor_concrete_tile03'),'concrete');
  assert.equal(classifySurface('unknown'),'concrete');
});

test('surface generation reproduces transforms, exclusions and remote-room crop before accepting an index',()=>{
  const source=fixture(),{index,report}=buildSurfaceIndex(source);
  assert.deepEqual(index.ranges,[[3,1],[6,2],[9,3]]);assert.equal(report.rejectedTriangles,1);
  assert.equal(index.verification.verifiedPositionBytes,108);
  assert.equal(index.verification.positionSha256,hash(source.collision.subarray(0,108)));
  assert.equal(report.materials.length,3);
  const corrupt=fixture();corrupt.collision.writeFloatLE(11,0);
  assert.throws(()=>buildSurfaceIndex(corrupt),/vertex order\/content differs/);
  const missing=fixture();missing.data.entities=[];
  assert.throws(()=>buildSurfaceIndex(missing),/totals differ/);
  const mixed=fixture();mixed.collision.writeUInt32LE(0,mixed.metadata.layout.index.byteOffset+4);
  assert.throws(()=>buildSurfaceIndex(mixed),/crosses source surface ranges/);
});

test('a BVH face resolves through its reordered vertex index at every surface boundary',()=>{
  const {index}=buildSurfaceIndex(fixture()),lookup=new SurfaceIndex(index);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(27),3));geometry.setIndex([6,7,8,0,1,2,3,4,5]);
  for(const [face,surface] of [[0,'metal'],[1,'carpet'],[2,'wood']])assert.equal(lookup.surfaceForHit({geometry},{faceIndex:face}),surface);
  for(const [vertex,surface] of [[0,'carpet'],[2,'carpet'],[3,'wood'],[5,'wood'],[6,'metal'],[8,'metal']])assert.equal(lookup.surfaceForVertex(vertex),surface);
  for(const vertex of [-1,9,NaN,Infinity,1.5])assert.equal(lookup.surfaceForVertex(vertex),'concrete');
  for(const face of [-1,3,NaN,1.5])assert.equal(lookup.surfaceForHit({geometry},{faceIndex:face}),'concrete');
  assert.equal(lookup.surfaceForHit({geometry},null),'concrete');
  geometry.setIndex([0,1,2]);assert.equal(lookup.surfaceForHit({geometry},{faceIndex:0}),'concrete');
  assert.equal(lookup.surfaceForHit({},{}),'concrete');
});

test('invalid, partial or future surface tables are rejected instead of silently misclassifying floors',()=>{
  const {index}=buildSurfaceIndex(fixture());
  for(const change of [{format:'future'},{vertices:0},{triangles:NaN},{classes:[...SURFACE_CLASSES].reverse()},{ranges:[[9,99]]},{ranges:[[9,1],[9,2]]},{ranges:[[6,1]]},{ranges:[[10,1]]}])assert.throws(()=>new SurfaceIndex({...index,...change}),TypeError);
});

test('the shipped surface map regenerates against exact native mesh and collision hashes',()=>{
  const gltf=read('export/web/kino.gltf'),buffer=read('export/web/kino.bin'),gameData=read('export/web/game-data.json');
  const sourceHashes={gltfSha256:hash(gltf),meshSha256:hash(buffer),gameDataSha256:hash(gameData),bakeSourceSha256:hash(read('.tools/bake-world.mjs'))};
  const {index}=buildSurfaceIndex({doc:JSON.parse(gltf),buffer,data:JSON.parse(gameData),metadata:json('export/web/collision.json'),collision:read('export/web/collision.bin'),sourceHashes});
  assert.deepEqual(index,json('export/web/surface-index.json'));
  assert.equal(index.vertices,4906224);assert.equal(index.triangles,1635408);assert.equal(index.verification.verifiedPositionBytes,58874688);
  assert(read('export/web/surface-index.json').length<8192,'lookup should stay compact');
});

test('real static BVH ground hits identify the stage wood, projection-room wood and theater carpet',()=>{
  const bytes=read('export/web/collision.bin'),world=deserializeCollisionWorld(json('export/web/collision.json'),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const lookup=new SurfaceIndex(json('export/web/surface-index.json'));
  for(const [origin,surface,floorY] of [[[-488,54,-1246],'wood',-16],[[-139,348,436],'wood',320],[[-328,73,490],'carpet',8.79985119047619],[[527,126,1261],'concrete',80]]){
    const hit=world.rayIntersect(new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(0,-1,0)),0,150);
    assert(hit);assert.equal(lookup.surfaceForHit(world,hit),surface);assert(Math.abs(hit.position.y-floorY)<.001);
  }
});
