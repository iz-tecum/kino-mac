import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { BoxLocator, BOX_LOCATOR_LOCATIONS, boxLocatorMatrix, boxLocatorStatus } from '../export/web/box-locator.js';
import { BOX_LOCATOR_BOARDS, boxLocatorBoard, restoreBoxLocatorDecals } from '../export/web/box-locator-boards.js';

const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url)));
const markers=data.entities.filter(e=>e.targetname==='magic_box_loc_light');
function template(){
  const root=new THREE.Group();
  for(const name of ['mc/mtl_lantern_body','mc/mtl_glass_v2_off','mc/mtl_filament'])root.add(new THREE.Mesh(new THREE.BoxGeometry(2,6,2),new THREE.MeshStandardMaterial({name})));
  return root;
}
async function fixture(){
  const scene=new THREE.Scene(),source=template(),world={activeBox:{id:1,script_noteworthy:'stage_chest'}},session={power:false,time:0,effects:{}},box={boxes:new Map([[1,{roll:null}]])};
  const locator=new BoxLocator(scene,data,world,session,box,async()=>source);await locator.load();
  return {scene,source,world,session,box,locator};
}

test('locator restores exactly 81 authored structs, nine for each original box location, absent from baked geometry',()=>{
  assert.equal(markers.length,81);
  for(const location of BOX_LOCATOR_LOCATIONS)assert.equal(markers.filter(e=>e.script_noteworthy===location).length,9);
  const gltf=JSON.parse(fs.readFileSync(new URL('../export/web/kino.gltf',import.meta.url)));
  const ids=new Set(markers.map(e=>e.id));
  assert(!gltf.nodes.some(n=>ids.has(n.extras?.entityId)));
  for(const n of gltf.nodes.filter(n=>/zapper_cagelight/.test(n.name??''))){
    const p=new THREE.Vector3(...(n.translation??n.matrix.slice(12,15)));
    assert(markers.every(e=>p.distanceTo(new THREE.Vector3(...e.position))>3),'do not duplicate a native baked lamp at a marker');
  }
});

test('native pitch/roll place wall lamps horizontally with orthonormal transforms',()=>{
  const e=markers[0],m=boxLocatorMatrix(e),origin=new THREE.Vector3().setFromMatrixPosition(m);
  assert.deepEqual(origin.toArray(),e.position);
  const localDown=new THREE.Vector3(0,-1,0).transformDirection(m);
  assert(Math.abs(localDown.x)>0.99999);assert(Math.abs(localDown.y)<1e-5);assert(Math.abs(localDown.z)<1e-5);
  assert(Math.abs(m.determinant()-1)<1e-8);
  for(const marker of markers){const m=boxLocatorMatrix(marker);assert(Math.abs(m.determinant()-1)<1e-8);assert(m.elements.every(Number.isFinite));}
});

test('native lamp geometry is shared in five batches with no dynamic lights or source-material mutation',async()=>{
  const {locator,source,scene}=await fixture();
  assert.equal(locator.batches.length,5);assert.equal(locator.snapshot().lamps,81);
  assert.equal(locator.snapshot().batches.reduce((n,b)=>n+b.count,0),243);
  let lights=0;scene.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  const geometries=new Set(source.children.map(c=>c.geometry));
  for(const {mesh} of locator.batches){assert(geometries.has(mesh.geometry));assert(!source.children.some(c=>c.material===mesh.material));}
  for(const c of source.children)assert.equal(c.material.emissive.getHex(),0);
});

test('ordinary box location lights only its nine markers after power, and follows relocation immediately',async()=>{
  const {locator,world,session}=await fixture();locator.update();assert.equal(locator.snapshot().lit.length,0);
  session.power=true;locator.update();let state=locator.snapshot();assert.equal(state.mode,'selected');assert.equal(state.lit.length,9);
  assert(state.lit.every(id=>data.entities.find(e=>e.id===id).script_noteworthy==='stage_chest_loc'));
  world.activeBox={id:2,script_noteworthy:'dining_chest'};locator.update();state=locator.snapshot();
  assert.equal(state.lit.length,9);assert(state.lit.every(id=>data.entities.find(e=>e.id===id).script_noteworthy==='dining_chest_loc'));
  world.activeBox.script_noteworthy='unknown';locator.update();assert.equal(locator.snapshot().lit.length,0);
});

test('teddy is not disclosed during the roll; revealed movement blinks all at native .25-second cadence',async()=>{
  const {locator,session,box}=await fixture();session.power=true;const roll={teddy:true,ready:false};box.boxes.get(1).roll=roll;
  locator.update();assert.equal(locator.snapshot().mode,'selected');roll.ready=true;locator.update();assert.equal(locator.snapshot().mode,'moving');assert.equal(locator.snapshot().lit.length,0);
  session.time=.249;locator.update();assert.equal(locator.snapshot().lit.length,0);
  session.time=.25;locator.update();assert.equal(locator.snapshot().lit.length,81);
  session.time=.5;locator.update();assert.equal(locator.snapshot().lit.length,0);
  box.boxes.get(1).roll=null;locator.update();assert.equal(locator.snapshot().lit.length,9);
});

test('Fire Sale overrides normal/moving state, flashes .3 seconds even before power, then restores selected state',async()=>{
  const {locator,session,box}=await fixture();session.effects.fire_sale=2;
  box.boxes.get(1).roll={teddy:true,ready:true};locator.update();assert.equal(locator.snapshot().mode,'fire-sale');
  session.time=.299;locator.update();assert.equal(locator.snapshot().lit.length,0);
  session.time=.3;locator.update();assert.equal(locator.snapshot().lit.length,81);
  session.time=.6;locator.update();assert.equal(locator.snapshot().lit.length,0);
  box.boxes.get(1).roll=null;session.time=2;locator.update();assert.equal(locator.snapshot().mode,'off');
  session.power=true;locator.update();assert.equal(locator.snapshot().lit.length,9);
});

test('pause follows simulation time, reduced flashes hold all green, and repeated reset reuses the same batches',async()=>{
  const {locator,session}=await fixture();const identities=locator.snapshot().batches.map(b=>[b.id,b.geometry,b.material]);
  session.effects.fire_sale=30;locator.update();session.time=.3;locator.update();assert.equal(locator.snapshot().lit.length,81);
  for(let i=0;i<10;i++)locator.update();assert.equal(locator.snapshot().lit.length,81);
  session.time=.6;locator.update(true);assert.equal(locator.snapshot().lit.length,81);
  session.time=.9;locator.update(true);assert.equal(locator.snapshot().lit.length,81);
  for(let i=0;i<5;i++){session.time=0;session.power=false;session.effects={};locator.reset();locator.update();assert.equal(locator.snapshot().lit.length,0);}
  assert.deepEqual(locator.snapshot().batches.map(b=>[b.id,b.geometry,b.material]),identities);
});

test('state changes do not reupload unchanged instance matrices; disposal preserves cached native geometry',async()=>{
  const {locator,source,session,scene}=await fixture();session.power=true;locator.update();
  const versions=locator.batches.map(b=>b.mesh.instanceMatrix.version);session.time=1;locator.update();
  assert.deepEqual(locator.batches.map(b=>b.mesh.instanceMatrix.version),versions);
  let geometryDisposals=0,materialDisposals=0;
  source.children.forEach(c=>c.geometry.addEventListener('dispose',()=>geometryDisposals++));
  locator.batches.forEach(b=>b.mesh.material.addEventListener('dispose',()=>materialDisposals++));
  locator.dispose();assert.equal(scene.children.length,0);assert.equal(geometryDisposals,0);assert.equal(materialDisposals,5);
});

test('empty marker set leaves other maps untouched',async()=>{
  const scene=new THREE.Scene(),locator=new BoxLocator(scene,{entities:[]},{},{time:0,effects:{}},{boxes:new Map()},async()=>{throw new Error('must not load Kino asset');});
  await locator.load();assert.equal(scene.children.length,0);assert.equal(locator.snapshot().lamps,0);
  assert.equal(boxLocatorStatus({activeBox:null},{time:0,power:true,effects:{}},{boxes:new Map()}).mode,'off');
});

test('all nine board frames match actual native chalk UV triangles and their named box triggers',()=>{
  const gltf=JSON.parse(fs.readFileSync(new URL('../export/web/kino.gltf',import.meta.url)));
  const material=gltf.materials.findIndex(m=>m.name==='wc/mtl_theater_chalkmap');
  const primitive=gltf.meshes[0].primitives.find(p=>p.material===material);
  function accessor(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],b=fs.readFileSync(new URL('../export/web/'+gltf.buffers[v.buffer].uri,import.meta.url));return new Float32Array(b.buffer,b.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*(a.type==='VEC3'?3:2));}
  const positions=accessor(primitive.attributes.POSITION),uvs=accessor(primitive.attributes.TEXCOORD_0),triggers=data.entities.filter(e=>e.targetname==='treasure_chest_use');
  assert.equal(BOX_LOCATOR_BOARDS.length,9);assert.equal(new Set(BOX_LOCATOR_BOARDS.map(b=>b.location)).size,9);
  for(const board of BOX_LOCATOR_BOARDS){
    const matches=[];
    for(let i=0;i<positions.length/3;i++){
      const expected=new THREE.Vector3(...board.origin).addScaledVector(new THREE.Vector3(...board.u),uvs[i*2]).addScaledVector(new THREE.Vector3(...board.v),uvs[i*2+1]);
      if(expected.distanceTo(new THREE.Vector3().fromArray(positions,i*3))<.025)matches.push([uvs[i*2],uvs[i*2+1]]);
    }
    assert(matches.length>=3,board.location+' comes from native UV geometry');
    assert(Math.max(...matches.map(v=>v[0]))-Math.min(...matches.map(v=>v[0]))>.4);
    assert(Math.max(...matches.map(v=>v[1]))-Math.min(...matches.map(v=>v[1]))>.4);
    const center=new THREE.Vector3(...board.origin).addScaledVector(new THREE.Vector3(...board.u),.5).addScaledVector(new THREE.Vector3(...board.v),.5);
    const byDistance=triggers.slice().sort((a,b)=>center.distanceTo(new THREE.Vector3(...a.position))-center.distanceTo(new THREE.Vector3(...b.position)));
    assert.equal(byDistance[0].script_noteworthy,board.location);assert(center.distanceTo(new THREE.Vector3(...byDistance[0].position))<175);
  }
});

test('all81 raw lamp positions match nine native panels with nine distinct source labels; appended IDs are not misplaced',()=>{
  const groups=new Map(BOX_LOCATOR_BOARDS.map(b=>[b.location,[]]));
  for(const marker of markers){const result=boxLocatorBoard(marker);assert(result,marker.id+' matches actual native panel');assert(result.distance<.54);groups.get(result.board.location).push(marker);}
  for(const group of groups.values()){assert.equal(group.length,9);assert.deepEqual(group.map(e=>e.script_noteworthy).sort(),[...BOX_LOCATOR_LOCATIONS].sort());}
  assert.equal(boxLocatorBoard(markers.find(e=>e.id===2516)).board.location,'stage_chest');
  assert.equal(boxLocatorBoard(markers.find(e=>e.id===2517)).board.location,'start_chest');
  assert.equal(boxLocatorBoard(markers.find(e=>e.id===2518)).board.location,'dining_chest');
  assert.equal(boxLocatorBoard(markers.find(e=>e.id===2519)).board.location,'dressing_chest');
});

test('native compound chalk layer projects only onto original coplanar backing, preserving depth occlusion and native image',()=>{
  const scene=new THREE.Scene(),texture=new THREE.Texture(),chalk=new THREE.MeshStandardMaterial({name:'wc/mtl_theater_chalkmap',map:texture}),wood=new THREE.MeshStandardMaterial({name:'wood'});
  wood.userData.sourceMaterialNames=['*53n_235(wc/jungle_woodpanel_wall:wc/mtl_theater_chalkmap)'];
  const backing=new THREE.PlaneGeometry(120,80);backing.translate(2.25,337,626);scene.add(new THREE.Mesh(backing,wood),new THREE.Mesh(new THREE.PlaneGeometry(1,1),chalk));
  const far=new THREE.Mesh(backing,wood);far.position.z=30;scene.add(far);
  const result=restoreBoxLocatorDecals(scene),overlay=scene.getObjectByName('box_locator_native_chalk_lobby');
  assert.equal(result.materials,1);assert.equal(result.geometryAdded,1);assert.equal(result.textureAdded,0);assert(result.triangles>0&&result.triangles<10);
  assert(overlay.material.polygonOffset&&overlay.material.depthTest&&!overlay.material.depthWrite);assert.equal(overlay.material.map,texture);assert.equal(wood.polygonOffset,false);assert.equal(chalk.polygonOffset,false);
  const p=overlay.geometry.attributes.position,uv=overlay.geometry.attributes.uv;
  for(let i=0;i<p.count;i++){assert(Math.abs(p.getZ(i)-626)<1e-5);assert(p.getX(i)>=-50.26&&p.getX(i)<=54.76);assert(p.getY(i)>=302.99&&p.getY(i)<=371.03);assert(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1);}
  assert.equal(restoreBoxLocatorDecals(scene),result);assert.equal(scene.children.filter(o=>o.name===overlay.name).length,1);
});

test('dispose and reload release only owned lamp/layer resources without accumulating meshes',async()=>{
  const {scene,locator}=await fixture();locator.dispose();
  const texture=new THREE.Texture(),chalk=new THREE.MeshStandardMaterial({name:'wc/mtl_theater_chalkmap',map:texture}),wood=new THREE.MeshStandardMaterial({name:'wood'});
  wood.userData.sourceMaterialNames=['*53n_235(wc/jungle_woodpanel_wall:wc/mtl_theater_chalkmap)'];
  const backing=new THREE.PlaneGeometry(120,80);backing.translate(2.25,337,626);
  scene.add(new THREE.Mesh(backing,wood),new THREE.Mesh(new THREE.PlaneGeometry(1,1),chalk));
  let sharedDisposals=0;for(const item of [texture,chalk,wood,backing])item.addEventListener('dispose',()=>sharedDisposals++);
  for(let cycle=0;cycle<3;cycle++){
    await locator.load();await locator.load();
    const overlay=scene.getObjectByName('box_locator_native_chalk_lobby');let ownedDisposals=0;
    for(const item of [overlay.geometry,overlay.material])item.addEventListener('dispose',()=>ownedDisposals++);
    assert.equal(scene.children.length,4);assert.equal(locator.root.children.length,5);
    assert.equal(scene.children.filter(o=>o.name===overlay.name).length,1);
    locator.dispose();locator.dispose();
    assert.equal(ownedDisposals,2);assert.equal(sharedDisposals,0);assert.equal(scene.children.length,2);assert.equal(locator.root.children.length,0);
  }
});
