import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Rig, ViewWeapon, useWeaponBindTranslations } from '../export/web/animation.js';
import { NativeAimPose, mergeWeaponAnimations, dualWeaponAnimations, ReloadPropVisibility, retargetAugPump } from '../export/web/weapon-pose.js';
import { Session } from '../export/web/rules.js';

const web=new URL('../export/web/',import.meta.url);
const data=JSON.parse(fs.readFileSync(new URL('game-data.json',web)));
const read=url=>JSON.parse(fs.readFileSync(new URL(url,web)));
const anim=(id,key)=>read(data.weapons[id].animations[key]);
const reloadClips=def=>Object.entries(def.animations).filter(([key])=>key.startsWith('reload')).map(([key,url])=>[key,read(url)]);
const fixture=id=>{const root=new THREE.Group(),torso=new THREE.Bone();torso.name='tag_torso';root.add(torso);return {root,torso,pose:new NativeAimPose(root,anim(id,'adsUpAnim'),anim(id,'adsDownAnim'))};};
const close=(a,b,tolerance=1e-5)=>assert(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('Stakeout ADS release follows native lowering rotation, not reverse raising',()=>{
  const {pose,torso}=fixture('ithaca_zm');pose.apply(0,1);pose.apply(1,1);pose.apply(.5,-1);
  assert(torso.quaternion.x>.07,'the authored lower curve rolls in the positive direction');
  close(torso.position.x,-3.6838375,.001);
  const raised=fixture('ithaca_zm');raised.pose.apply(.5,1);
  assert(raised.torso.quaternion.x<-.04,'the raising curve rolls in the opposite direction');
  pose.apply(0,-1);close(torso.position.x,-4.6318);close(torso.position.y,0);close(torso.quaternion.x,0);
});

test('Ray Gun native lowering dip and G11 ADS durations remain weapon specific',()=>{
  const {pose,torso}=fixture('ray_gun_zm');pose.apply(1,1);pose.apply(.5,-1);
  assert(torso.position.z<-1.4,'Ray Gun dips below its hip height while lowering');
  assert(torso.quaternion.y<-.03);pose.apply(0,-1);close(torso.position.z,-.6465);
  assert.equal(data.weapons.g11_lps_zm.adsInTime,.3);assert.equal(data.weapons.g11_lps_zm.adsOutTime,.6);
});

test('mid-raise and mid-lower reversals are pose-continuous and still reach native endpoints',()=>{
  const {pose,torso}=fixture('ithaca_zm');pose.apply(0,1);pose.apply(.37,1);
  const position=torso.position.clone(),rotation=torso.quaternion.clone();pose.apply(.37,-1);
  assert(torso.position.distanceTo(position)<1e-7);assert(torso.quaternion.angleTo(rotation)<1e-7);
  pose.apply(.2,-1);const lowered=torso.position.clone();pose.apply(.2,1);
  assert(torso.position.distanceTo(lowered)<1e-7);pose.apply(1,1);
  close(torso.position.x,-2.7358);close(torso.position.z,.0387);close(torso.quaternion.x,0);
});

test('reload/melee retain native torso tracks while ADS rests and missing lower curves fall back',()=>{
  const {pose,torso}=fixture('ithaca_zm');pose.apply(1,1);torso.position.set(9,8,7);
  pose.apply(0,-1,{restOnly:true,clip:{bones:[{name:'tag_torso',pos:{}}]}});
  assert.deepEqual(torso.position.toArray(),[9,8,7]);
  pose.apply(0,-1,{restOnly:true,clip:{bones:[]}});close(torso.position.x,-4.6318);
  const fallback=new NativeAimPose(torso,anim('m1911_zm','adsUpAnim'));
  fallback.apply(.5,1);const up=torso.position.clone();fallback.apply(.5,-1);
  assert(torso.position.distanceTo(up)<1e-7);fallback.apply(0,-1);close(torso.position.x,-4.6318);
});

test('dual CZ75 reload retains staggered left/right magazine sounds without duplicate shared bones',()=>{
  const def=data.weapons.cz75dw_zm;
  const right=read(def.animations.reloadAnim),left=read(def.leftAnimations.reloadAnimLeft);
  const both=mergeWeaponAnimations(right,left,'dual');
  assert.deepEqual(both.notifies.filter(n=>n.name==='sndnt#fly_cz75_mag_out').map(n=>n.time),[.4,.5333]);
  assert.deepEqual(both.notifies.filter(n=>n.name==='sndnt#fly_cz75_mag_in').map(n=>n.time),[1.1333,1.1667]);
  assert.equal(both.bones.filter(b=>b.name==='tag_gasmask').length,1);
  assert(both.bones.some(b=>b.name==='tag_weapon'));assert(both.bones.some(b=>b.name==='tag_weapon1'));
  assert.deepEqual(mergeWeaponAnimations(right,right,'same').notifies,right.notifies);
});

test('looping native notifies repeat in timeline order through frame skips and obey pause',()=>{
  const calls=[],rig=new Rig(new THREE.Group(),name=>calls.push(name));
  rig.add('loop',{name:'loop',fps:30,duration:1,bones:[],notifies:[{name:'start',time:0},{name:'end',time:.75}]});
  rig.play('loop',true,2,0);rig.update(0);assert.deepEqual(calls,['start']);
  rig.update(0);assert.equal(calls.length,1);rig.update(1.1);
  assert.deepEqual(calls,['start','end','start','end','start']);
  rig.actions.loop.paused=true;rig.update(4);assert.equal(calls.length,5);
  rig.actions.loop.paused=false;rig.update(.4);assert.deepEqual(calls.slice(-2),['end','start']);
});

test('upgraded PM63 uses its separate left empty reload and left last-shot animations',()=>{
  const def={...data.weapons.pm63_zm,...data.weapons.pm63_zm.upgrade};
  const right=new Map(Object.entries(def.animations).map(([key,url])=>[key,read(url)]));
  const left=new Map(Object.entries(def.leftAnimations).map(([key,url])=>[key,read(url)]));
  const both=new Map(dualWeaponAnimations(right,left));
  const empty=left.get('reloadEmptyAnimLeft'),partial=left.get('reloadAnimLeft');
  assert.notDeepEqual(empty.bones.find(b=>b.name==='tag_weapon1'),partial.bones.find(b=>b.name==='tag_weapon1'));
  assert.deepEqual(both.get('reloadEmptyAnim').bones.find(b=>b.name==='tag_weapon1'),empty.bones.find(b=>b.name==='tag_weapon1'));
  assert.deepEqual(both.get('leftLastShotAnim').bones.find(b=>b.name==='tag_weapon1'),left.get('lastShotAnimLeft').bones.find(b=>b.name==='tag_weapon1'));
});

test('one-shot reload notifies respect native duration scaling and never replay after completion',()=>{
  const calls=[],rig=new Rig(new THREE.Group(),name=>calls.push(name)),clip=anim('m1911_zm','reloadAnim');
  rig.add('reload',clip);rig.play('reload',false,clip.duration/1.63,0);
  rig.update(.95);assert(!calls.includes('sndnt#fly_colt45_mag_in'));
  rig.update(.04);assert(calls.includes('sndnt#fly_colt45_mag_in'));rig.update(3);
  const count=calls.length;rig.update(10);assert.equal(calls.length,count);assert.equal(calls.filter(n=>n==='sndnt#fly_colt45_mag_in').length,1);
});

test('native sprint exit blocks the muzzle until its authored duration, then reliably permits firing',()=>{
  const view=new ViewWeapon(new THREE.Scene(),data),def=data.weapons.mp40_zm;
  view.ready=true;view.def=def;view.root=new THREE.Group();view.rig=new Rig(view.root);view.knives={};view.aimPose=new NativeAimPose(view.root);
  for(const key of ['idleAnim','sprintInAnim','sprintLoopAnim','sprintOutAnim'])view.rig.add(key,read(def.animations[key]));
  view.mode='idle';view.rig.play('idleAnim',true,1,0);assert(view.canFire);
  view.update(0,{sprint:true});assert.equal(view.mode,'sprintIn');assert(!view.canFire);
  view.update(def.sprintInTime+.001,{sprint:true});assert.equal(view.mode,'sprint');assert(!view.canFire);
  view.update(0,{sprint:false});assert.equal(view.mode,'sprintOut');assert(!view.canFire);
  view.update(def.sprintOutTime-.001,{sprint:false});assert(!view.canFire);
  view.update(.002,{sprint:false});assert.equal(view.mode,'idle');assert(view.canFire);
  view.mode='reload';assert(view.canFire,'Session must still receive segmented-reload interrupt requests');
});

test('partial shotgun reload interruption survives animation gating and switching never transfers cancelled shells',()=>{
  const s=new Session(data);s.giveWeapon('ithaca_zm');s.weapon.mag=0;s.reload();s.update(s.reloadDuration+.001);
  assert.equal(s.weapon.mag,1);s.interruptReload();assert(s.reloadInterrupted);
  s.update(s.reloadLeft+.001);assert.equal(s.reloadStage,'end');assert(!s.fire());
  s.update(s.reloadLeft+.001);assert(s.fire());const total=s.weapon.mag+s.weapon.reserve;
  s.update(1);s.reload();s.switchWeapon(0);s.update(20);assert.equal(s.inventory[1].mag+s.inventory[1].reserve,total);
});

test('Ray Gun authored sprint-out delay works even though it uses offsets instead of sprint clips',()=>{
  const view=new ViewWeapon(new THREE.Scene(),data),def=data.weapons.ray_gun_zm;
  view.ready=true;view.def=def;view.root=new THREE.Group();view.rig=new Rig(view.root);view.knives={};view.aimPose=new NativeAimPose(view.root);
  view.rig.add('idleAnim',read(def.animations.idleAnim));view.rig.play('idleAnim',true,1,0);
  view.update(.2,{sprint:true});assert.equal(view.mode,'sprint');assert(!view.canFire);
  view.update(0,{sprint:false});assert.equal(view.mode,'sprintOut');assert(!view.canFire);
  view.update(.199,{sprint:false});assert(!view.canFire);view.update(.002,{sprint:false});assert(view.canFire);assert.equal(view.mode,'idle');
});

test('segmented reload props appear for insertion and hide at native clip-in, idle, and end stages',()=>{
  const root=new THREE.Group(),clip=new THREE.Bone(),body=new THREE.Bone();clip.name='tag_clip';body.name='j_gun';root.add(clip,body);
  const props=new ReloadPropVisibility(root,data.weapons.ithaca_zm,reloadClips(data.weapons.ithaca_zm));assert(!props.snapshot().visible);assert(clip.scale.x<.00001);assert.equal(body.scale.x,1);
  props.begin('start');assert.equal(clip.scale.x,1);props.notify('sndnt#fly_gear_reload_plr');assert(props.snapshot().visible);
  props.notify('rmbnt#reload_clipin');assert(!props.snapshot().visible);
  props.begin('shell');assert(props.snapshot().visible);props.begin('end');assert(!props.snapshot().visible);
  props.begin('start');props.notify('sndnt#fly_mk_shell_in');assert(!props.snapshot().visible,'Masterkey start clip uses its shell sound rather than a clip-in rumble');
  props.begin('shell');props.set(false);assert(!props.snapshot().visible);
});

test('magazine-fed guns, revolvers, and static hidden attachments are excluded from reload-prop visibility',()=>{
  const root=new THREE.Group(),clip=new THREE.Bone();clip.name='tag_clip';root.add(clip);
  const magazine=new ReloadPropVisibility(root,data.weapons.mp40_zm,reloadClips(data.weapons.mp40_zm));assert.equal(magazine.parts.length,0);assert.equal(clip.scale.x,1);
  const revolver=new ReloadPropVisibility(root,data.weapons.python_zm,reloadClips(data.weapons.python_zm));assert.equal(revolver.parts.length,0);assert.equal(clip.scale.x,1);
  clip.scale.setScalar(.000001);const hidden=new ReloadPropVisibility(root,{segmentedReload:true,pellets:8,hideTags:['tag_clip']},reloadClips(data.weapons.ithaca_zm));
  hidden.begin('shell');assert.equal(clip.scale.x,.000001);assert.equal(hidden.parts.length,0);
});

test('Masterkey hides its animated shell without hiding the rifle magazine',()=>{
  const root=new THREE.Group(),clip=new THREE.Bone(),shell=new THREE.Bone();clip.name='tag_clip';shell.name='tag_ammo2';root.add(clip,shell);
  const def=data.weapons.aug_acog_zm.upgrade.attachment,props=new ReloadPropVisibility(root,def,reloadClips(def));
  assert.deepEqual(props.snapshot().tags,['tag_ammo2']);assert.equal(clip.scale.x,1);assert(shell.scale.x<.00001);
  props.begin('shell');assert.equal(clip.scale.x,1);assert.equal(shell.scale.x,1);props.notify('sndnt#fly_mk_shell_in');assert.equal(clip.scale.x,1);assert(shell.scale.x<.00001);
});

test('native M1911 and M16 reload magazines return to their bind sockets instead of the gun origin',()=>{
  for(const id of ['m1911_zm','m16_zm'])for(const key of ['reloadAnim','reloadEmptyAnim']){
    const bytes=fs.readFileSync(new URL(data.weapons[id].model,web)),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
    const source=gltf.nodes.find(n=>n.name==='tag_clip'),bone=new THREE.Bone(),root=new THREE.Group();bone.name='tag_clip';bone.position.fromArray(source.translation);root.add(bone);useWeaponBindTranslations(root);
    const clip=anim(id,key),rig=new Rig(root);rig.add('reload',clip);rig.play('reload',false,1,0);rig.update(clip.duration+.01);
    assert(bone.position.distanceTo(new THREE.Vector3(...source.translation))<.01,id+' seated magazine');
    assert(bone.position.length()>1,id+' never collapses its socket to the gun origin');
  }
});

test('weapon translation correction preserves native rotations and never changes arm bone positions',()=>{
  const root=new THREE.Group(),gun=new THREE.Group(),part=new THREE.Bone(),arm=new THREE.Bone();part.name='j_clip';arm.name='j_wrist_le';part.position.set(4,1,-2);gun.add(part);root.add(gun,arm);useWeaponBindTranslations(gun);
  const rot=[0,Math.sin(.2),0,Math.cos(.2)],rig=new Rig(root);
  rig.add('pose',{name:'pose',fps:30,duration:1,bones:[{name:'j_clip',pos:{frames:[0],values:[1,2,3]},rot:{frames:[0],values:rot}},{name:'j_wrist_le',pos:{frames:[0],values:[11.57,0,0]},rot:null}],notifies:[]});
  rig.play('pose',false,1,0);rig.update(0);assert.deepEqual(part.position.toArray(),[5,3,1]);close(part.quaternion.y,rot[1]);close(arm.position.x,11.57);
});

const augFixture=()=>{
  const base=data.weapons.aug_acog_zm,bytes=fs.readFileSync(new URL(base.model,web));
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12))),source=gltf.nodes.find(n=>n.name==='tag_pump2');
  const root=new THREE.Group(),pump=new THREE.Bone();pump.name=source.name;pump.position.fromArray(source.translation);pump.quaternion.fromArray(source.rotation);root.add(pump);
  return {root,pump,base,bind:pump.quaternion.clone().normalize()};
};

test('AUG Masterkey pump stays seated across native idle/reload and sprint bases without retargeting arms',()=>{
  const {root,pump,base,bind}=augFixture();
  for(const def of [{...base,...base.upgrade},base.upgrade.attachment]){
    const native=Object.entries(def.animations).map(([key,url])=>[key,read(url)]),before=JSON.stringify(native),fixed=retargetAugPump(root,def,native);
    const idle=native.find(([key])=>key==='idleAnim')[1].bones.find(b=>b.name===pump.name);
    close(bind.angleTo(new THREE.Quaternion().fromArray(idle.rot.values).normalize()),2*Math.PI/3);
    let changed=0;
    for(let index=0;index<fixed.length;index++){
      const [key,clip]=fixed[index],original=native[index][1],part=clip.bones.find(b=>b.name===pump.name);
      if(!part?.rot)continue;
      for(let i=0;i<part.rot.values.length;i+=4)assert(bind.angleTo(new THREE.Quaternion().fromArray(part.rot.values,i).normalize())<.001,key+' keeps pump aligned');
      assert.deepEqual(part.pos,original.bones.find(b=>b.name===pump.name).pos,'native pump stroke unchanged');
      assert.deepEqual(clip.bones.filter(b=>b.name!==pump.name),original.bones.filter(b=>b.name!==pump.name),'arms and other gun parts unchanged');
      if(key.startsWith('sprint'))assert.equal(clip,original,'correct native sprint clips retained verbatim');
      if(clip!==original)changed++;
    }
    assert(changed>=9,'the demonstrated mismatched family is corrected');assert.equal(JSON.stringify(native),before,'cached source clips remain immutable');
  }
});

test('Masterkey reload end preserves its full pump stroke and returns to the same idle socket',()=>{
  const {root,pump,base,bind}=augFixture(),def=base.upgrade.attachment;
  const entries=retargetAugPump(root,def,Object.entries(def.animations).map(([key,url])=>[key,read(url)]));
  useWeaponBindTranslations(root);const rest=pump.position.clone(),rig=new Rig(root);for(const [key,clip] of entries)rig.add(key,clip);
  rig.play('idleAnim',true,1,0);rig.update(0);assert(pump.quaternion.angleTo(bind)<.001);
  rig.play('reloadEndAnim',false,1,0);rig.update(24/30);
  close(pump.position.x-rest.x,-2.3117,.001);assert(pump.quaternion.angleTo(bind)<.001);
  rig.update(2);assert(pump.position.distanceTo(rest)<.001);assert(pump.quaternion.angleTo(bind)<.001);
  rig.play('sprintInAnim',false,1,0);rig.update(.2);assert(pump.quaternion.angleTo(bind)<.001);
  rig.play('idleAnim',true,1,0);rig.update(0);assert(pump.position.distanceTo(rest)<.001);assert(pump.quaternion.angleTo(bind)<.001);
});

test('ordinary AUG rifle and an unrelated or differently animated component cannot be retargeted',()=>{
  const {root,base}=augFixture(),entries=Object.entries(base.animations).map(([key,url])=>[key,read(url)]);
  assert.equal(retargetAugPump(root,base,entries),entries,'ordinary AUG and its hidden pump are unchanged');
  const upgraded={...base,...base.upgrade},clips=Object.entries(upgraded.animations).map(([key,url])=>[key,read(url)]);
  assert.equal(retargetAugPump(root,{...upgraded,model:'models/other.glb'},clips),clips);
  const copy=structuredClone(clips),idle=copy.find(([key])=>key==='idleAnim')[1];idle.bones.find(b=>b.name==='tag_pump2').rot.values=[0,Math.sin(.3),0,Math.cos(.3)];
  assert.equal(retargetAugPump(root,upgraded,copy).find(([key])=>key==='idleAnim')[1],idle,'unrecognized authored rotation is preserved');
});
