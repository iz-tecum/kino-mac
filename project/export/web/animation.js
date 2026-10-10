import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetManager, disposeSkeletons } from './runtime-assets.js';
import { NativeAimPose, dualWeaponAnimations, ReloadPropVisibility, retargetAugPump } from './weapon-pose.js';
import { WeaponMotion } from './weapon-motion.js';

const loader=new GLTFLoader(assetManager), models=new Map(), clips=new Map();
export async function loadModel(url){if(!url)return null;if(!models.has(url))models.set(url,loader.loadAsync(url).then(gltf=>gltf.scene));return clone(await models.get(url));}
export async function loadAnimation(url){if(!clips.has(url))clips.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error('Animation '+url+': '+r.status);return r.json();}));return clips.get(url);}
export function useWeaponBindTranslations(model){
  // T5 weapon-part translations are offsets from the XModel bind position.
  // For example M1911/M16 reload tag_clip returns to ~zero, while the actual
  // magazine socket has a nonzero bind offset. Arm translations and all
  // quaternion tracks are absolute native poses and must remain unchanged.
  model.traverse(node=>{if(node.isBone)node.userData.weaponBindPosition=node.position.toArray();});
}
export function makeClip(root, data, locomotion=false){
  const tracks=[];const nodes=new Map();
  root.traverse(n=>{if(!nodes.has(n.name))nodes.set(n.name,[]);nodes.get(n.name).push(n);});
  for(const b of data.bones){
    if(b.name==='tag_origin'||b.name==='tag_sync')continue;
    for(const node of nodes.get(b.name)??[]){
      if(node.userData.animationAnchor)continue;
      if(b.rot)tracks.push(new THREE.QuaternionKeyframeTrack(node.uuid+'.quaternion',b.rot.frames.map(f=>f/data.fps),b.rot.values));
      if(b.pos){
        const values=b.pos.values.slice();
        const bind=node.userData.weaponBindPosition;
        if(bind)for(let i=0;i<values.length;i+=3){values[i]+=bind[0];values[i+1]+=bind[1];values[i+2]+=bind[2];}
        // T5 locomotion stores j_mainroot translations as displacement from
        // the bind pelvis, unlike the absolute viewmodel pose tracks.
        if(locomotion&&b.name==='j_mainroot')for(let i=0;i<values.length;i+=3){values[i]=node.position.x;values[i+1]=node.position.y;values[i+2]+=node.position.z;}
        tracks.push(new THREE.VectorKeyframeTrack(node.uuid+'.position',b.pos.frames.map(f=>f/data.fps),values));
      }
    }
  }
  return new THREE.AnimationClip(data.name,Math.max(1/data.fps,data.duration),tracks);
}
export class Rig {
  constructor(root,onNotify=()=>{}){this.root=root;this.mixer=new THREE.AnimationMixer(root);this.actions={};this.data={};this.current=null;this.onNotify=onNotify;this.elapsed=0;}
  add(key,data,locomotion=false){this.data[key]=data;this.actions[key]=this.mixer.clipAction(makeClip(this.root,data,locomotion));}
  play(key,loop=true,speed=1,fade=.1){
    const a=this.actions[key];if(!a)return false;if(this.current===key&&loop)return true;
    const old=this.actions[this.current];
    // Fading a short firing action into itself erased most of its recoil.
    if(old&&old!==a){if(fade)old.fadeOut(fade);else old.stop();}
    a.stop().reset().setEffectiveWeight(1).setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    a.clampWhenFinished=!loop;a.timeScale=speed;if(fade)a.fadeIn(fade);a.play();this.current=key;this.elapsed=-1e-6;return true;
  }
  update(dt){
    const action=this.actions[this.current],data=this.data[this.current],before=this.elapsed;
    if(action&&!action.paused){
      this.elapsed=Math.max(0,this.elapsed)+dt*action.timeScale;
      const duration=action.getClip().duration,loop=action.loop===THREE.LoopRepeat;
      const pending=[];
      for(const n of data.notifies??[]){
        const first=loop?Math.max(0,Math.floor((before-n.time)/duration)+1):0;
        const last=loop?Math.floor((this.elapsed-n.time)/duration):0;
        for(let cycle=first;cycle<=last;cycle++){
          const time=n.time+cycle*duration;
          if(time>before&&time<=this.elapsed)pending.push({time,name:n.name});
        }
      }
      pending.sort((a,b)=>a.time-b.time);
      for(const notify of pending)this.onNotify(notify.name,this.current);
    }
    this.mixer.update(dt);
  }
}

const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,-1),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0));
export class ViewWeapon {
  constructor(scene,data,onSound=()=>{}){
    this.scene=scene;this.data=data;this.onSound=onSound;this.pivot=new THREE.Group();scene.add(this.pivot);
    this.token=0;this.currentId=null;this.recoil=0;this.aim=0;this.mode='idle';this.meleeLeft=0;this.sprintBlend=0;this.sprintExitLeft=0;
    this.motion=new WeaponMotion();
  }
  async equip(def){
    const key=def.id+(def.upgraded?':upgraded':'')+(def.attachmentActive?':attachment':'');
    if(this.currentId===key&&this.ready)return;this.currentId=key;this.ready=false;const token=++this.token;
    this.pivot.visible=false;
    const [hands,gun,leftGun,...knives]=await Promise.all([
      loadModel(def.handsModel??this.data.characters.viewmodel_usa_pow_arms??this.data.characters.viewhands_usmc),loadModel(def.model),
      def.leftModel?loadModel(def.leftModel):Promise.resolve(null),
      ...Object.values(this.data.melee).map(d=>loadModel(d.model))]);
    let entries=await Promise.all(Object.entries(def.animations).map(async([key,url])=>[key,await loadAnimation(url)]));
    if(def.leftAnimations){
      const left=new Map(await Promise.all(Object.entries(def.leftAnimations).filter(([key])=>key.endsWith('AnimLeft')).map(async([key,url])=>[key,await loadAnimation(url)])));
      entries=dualWeaponAnimations(new Map(entries),left);
    }
    entries=retargetAugPump(gun,def,entries);
    const meleeEntries=await Promise.all(Object.entries(this.data.melee).flatMap(([type,d])=>
      Object.entries(d.animations).filter(([k])=>k.startsWith('melee')).map(async([key,url])=>[type+':'+key,await loadAnimation(url)])));
    if(token!==this.token){for(const model of [hands,gun,leftGun,...knives])disposeSkeletons(model);return;}
    if(this.rig)this.rig.mixer.uncacheRoot(this.rig.root);
    disposeSkeletons(this.root);
    if(!hands||!gun)throw new Error('Missing viewmodel for '+def.id);
    this.def=def;this.pivot.clear();this.pivot.position.set(0,0,0);this.pivot.rotation.set(0,0,0);
    // Assemble outside the scene. Using matrixWorld under the previous gun's
    // ADS/recoil pivot baked that pose into every subsequent weapon attachment.
    this.root=new THREE.Group();this.root.add(hands);this.gun=gun;this.hands=hands;
    const view=hands.getObjectByName('tag_view'),tag=hands.getObjectByName('tag_weapon');
    if(!view||!tag)throw new Error('Missing viewmodel attachment bones');
    view.userData.animationAnchor=true;
    this.root.updateMatrixWorld(true);
    const cameraBasis=new THREE.Matrix4().multiplyMatrices(basis,view.matrixWorld.clone().invert());
    const attach=(model,parent,boneName)=>{
      model.updateMatrixWorld(true);
      let bone=model.getObjectByName(boneName);model.traverse(n=>{if(!bone&&n.isBone)bone=n;});
      if(!bone)throw new Error('Missing attachment root '+boneName);
      bone.userData.animationAnchor=true;
      model.matrixAutoUpdate=false;model.matrix.copy(bone.matrixWorld).invert();parent.add(model);
    };
    useWeaponBindTranslations(gun);attach(gun,tag,'j_gun');
    this.leftGun=leftGun;
    if(leftGun){useWeaponBindTranslations(leftGun);const leftTag=hands.getObjectByName('tag_weapon1');if(leftTag)attach(leftGun,leftTag,leftGun.getObjectByName('j_gun1')?'j_gun1':'j_gun');}
    // Bottles animate j_gun relative to tag_weapon throughout opening/drinking.
    // Freezing that root leaves the bottle behind while the hands move away.
    if(def.id.startsWith('zombie_perk_bottle_')){gun.getObjectByName('j_gun').userData.animationAnchor=false;gun.matrix.identity();}
    this.knives={};const knifeTag=hands.getObjectByName('tag_knife_attach');
    if(knifeTag)Object.keys(this.data.melee).forEach((type,i)=>{attach(knives[i],knifeTag,'tag_knife');knives[i].visible=false;this.knives[type]=knives[i];});
    this.hiddenTags=[];
    for(const name of def.hideTags??[]){const bone=gun.getObjectByName(name);if(bone){bone.scale.setScalar(.000001);this.hiddenTags.push(name);}}
    this.reloadProps=new ReloadPropVisibility(gun,def,entries);
    this.root.matrixAutoUpdate=false;this.root.matrix.copy(cameraBasis);this.pivot.add(this.root);
    this.rig=new Rig(this.root,(name)=>{this.reloadProps.notify(name);this.onSound(name,this.meleeType?this.data.melee[this.meleeType]:this.def);});
    for(const [key,clip] of [...entries,...meleeEntries])this.rig.add(key,clip);
    // ADS is a separate native animation of tag_torso. Its first frame also
    // defines each gun's HIP pose; the arms' bind torso is only right for M1911.
    this.aimPose=new NativeAimPose(hands,entries.find(([key])=>key==='adsUpAnim')?.[1],entries.find(([key])=>key==='adsDownAnim')?.[1]);
    this.aim=0;this.recoil=0;this.motion.reset();this.meleeLeft=0;this.meleeType=null;this.sprintBlend=0;this.sprintExitLeft=0;this.applyAim();
    this.rig.play('idleAnim',true,1,0);this.rig.update(0);
    this.mode=this.rig.play('raiseAnim',false,this.clipSpeed('raiseAnim',def.raiseTime),.04)?'raise':'idle';
    this.root.traverse(o=>{o.frustumCulled=false;});
    this.ready=true;this.pivot.visible=true;
  }
  clipSpeed(key,duration){return duration>0?(this.rig.data[key]?.duration??duration)/duration:1;}
  applyAim(restOnly=false,direction=1){this.aimPose.apply(this.aim,direction,{restOnly,clip:this.rig.data[this.rig.current]});}
  // Session still owns ammunition/reload eligibility; this covers the authored
  // weapon-raising and sprint-out intervals before the muzzle is ready.
  get canFire(){return !!this.ready&&this.meleeLeft<=0&&!['raise','sprintIn','sprint','sprintOut'].includes(this.mode);}
  shoot({ads=false,empty=false,hand='right'}={}){
    if(!this.ready||this.meleeLeft>0)return;
    let key=ads?(empty?'adsLastShotAnim':'adsFireAnim'):(empty?'lastShotAnim':'fireAnim');
    if(hand==='left'&&this.rig.actions.leftFireAnim)key=empty&&this.rig.actions.leftLastShotAnim?'leftLastShotAnim':'leftFireAnim';
    if(!this.rig.actions[key])key='fireAnim';this.recoil=1;this.motion.fire();this.mode='fire';this.rig.play(key,false,1,0);
  }
  reload(empty,duration,stage='magazine'){
    if(!this.ready)return;const key=stage==='start'?'reloadStartAnim':stage==='end'?'reloadEndAnim':empty&&this.rig.actions.reloadEmptyAnim?'reloadEmptyAnim':'reloadAnim';
    this.mode='reload';this.aim=0;this.reloadProps.begin(stage);this.rig.play(key,false,this.clipSpeed(key,duration),.06);
  }
  melee(type='knife',charge=false){
    if(!this.ready||this.meleeLeft>0)return null;
    if(this.def.melee){
      const d=this.def.melee,key=charge?'meleeChargeAnim':'meleeAnim',duration=Math.max(charge?d.meleeChargeTime:d.meleeTime,this.rig.data[key]?.duration??0);
      this.meleeType=null;this.meleeLeft=duration;this.mode='melee';this.aim=0;this.rig.play(key,false,this.clipSpeed(key,duration),0);
      return {duration,delay:charge?d.meleeChargeDelay:d.meleeDelay,damage:d.meleeDamage};
    }
    const def=this.data.melee[type],key=type+':'+(charge?'meleeChargeAnim':'meleeAnim');
    const duration=Math.max(charge?def.chargeTime:def.time,this.rig.data[key].duration);
    this.meleeType=type;this.meleeLeft=duration;this.mode='melee';this.aim=0;
    for(const [k,model] of Object.entries(this.knives))model.visible=k===type;
    this.rig.play(key,false,this.clipSpeed(key,duration),0);
    return {duration,delay:charge?def.chargeDelay:def.delay,damage:def.damage};
  }
  update(dt,{moving=false,sprint=false,ads=false,reloading=false,empty=false,time=0,speed,grounded=true}={}){
    if(!this.ready)return;
    // Cancellation must select the idle timeline before advancing the mixer.
    // Otherwise a cancelled reload can emit its next shell/magazine notify.
    const reloadAction=this.rig.actions[this.rig.current];
    const completesNow=reloadAction&&reloadAction.time+dt*reloadAction.timeScale>=reloadAction.getClip().duration-1e-5;
    if(this.mode==='reload'&&!reloading&&!completesNow){this.mode='idle';this.reloadProps?.set(false);this.rig.play(empty&&this.rig.actions.emptyIdleAnim?'emptyIdleAnim':'idleAnim',true,1,.06);}
    this.rig.update(dt);this.meleeLeft=Math.max(0,this.meleeLeft-dt);this.sprintExitLeft=Math.max(0,this.sprintExitLeft-dt);
    const action=this.rig.actions[this.rig.current],finished=!action?.isRunning();
    const sprintKey=phase=>{const key='sprint'+phase+(empty?'Empty':'')+'Anim';return this.rig.actions[key]?key:'sprint'+phase+'Anim';};
    if(this.mode==='melee'&&this.meleeLeft===0){for(const model of Object.values(this.knives))model.visible=false;this.meleeType=null;this.mode='idle';}
    if(this.mode==='reload'&&!reloading)this.mode='idle';
    if(['fire','raise'].includes(this.mode)&&finished)this.mode='idle';
    if(this.mode==='sprintOut'&&this.sprintExitLeft===0&&(finished||!this.rig.actions[sprintKey('Out')]))this.mode='idle';
    if(this.mode==='sprintIn'&&finished){this.mode='sprint';this.rig.play(sprintKey('Loop'),true,this.clipSpeed(sprintKey('Loop'),this.def.sprintLoopTime),.04);}
    if(['idle','fire'].includes(this.mode)&&sprint){this.mode='sprintIn';if(!this.rig.play(sprintKey('In'),false,this.clipSpeed(sprintKey('In'),this.def.sprintInTime),.06)){this.mode='sprint';this.rig.play(this.rig.actions[sprintKey('Loop')]?sprintKey('Loop'):'idleAnim');}}
    if(['sprint','sprintIn'].includes(this.mode)&&!sprint){this.mode='sprintOut';this.sprintExitLeft=this.def.sprintOutTime??0;if(!this.rig.play(sprintKey('Out'),false,this.clipSpeed(sprintKey('Out'),this.def.sprintOutTime),.04))this.rig.play('idleAnim',true,1,.04);}
    if(this.mode==='idle')this.rig.play(empty&&this.rig.actions.emptyIdleAnim?'emptyIdleAnim':'idleAnim',true,1,.06);
    if(this.mode!=='reload')this.reloadProps?.set(false);
    const aiming=ads&&['idle','fire'].includes(this.mode);
    this.aim=THREE.MathUtils.clamp(this.aim+(aiming?dt/Math.max(.01,this.def.adsInTime):-dt/Math.max(.01,this.def.adsOutTime)),0,1);
    this.applyAim(!['idle','fire'].includes(this.mode),aiming?1:-1);
    const motion=this.motion.update(dt,{speed:['melee','reload','raise'].includes(this.mode)?0:(speed??(moving?(sprint?285:190):0)),grounded,aim:this.aim,enabled:(this.bobAmount??1)>0});
    this.recoil=motion.kick*4;
    this.pivot.position.fromArray(motion.offset);this.pivot.rotation.set(...motion.rotation);
    // Ray Gun uses authored weapon offsets in place of sprint XAnims.
    const offsetSprint=sprint&&!this.rig.actions.sprintLoopAnim&&this.mode==='sprint';
    this.sprintBlend=THREE.MathUtils.damp(this.sprintBlend,offsetSprint?1:0,16,dt);
    if(this.sprintBlend>.001){this.pivot.position.addScaledVector(new THREE.Vector3(...this.def.sprintOffset),this.sprintBlend);const r=this.def.sprintRotation;this.pivot.rotation.set(r[0]*this.sprintBlend,r[1]*this.sprintBlend,r[2]*this.sprintBlend);}
    this.root.updateMatrixWorld(true);
  }
  snapshot(){
    const position=name=>this.root?.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()).toArray();
    return {ready:this.ready,canFire:this.canFire,id:this.currentId,hiddenTags:this.hiddenTags??[],mode:this.mode,animation:this.rig?.current,
      time:this.rig?.actions[this.rig.current]?.time,aim:this.aim,melee:this.meleeType,meleeLeft:this.meleeLeft,reloadProps:this.reloadProps?.snapshot(),motion:this.motion.snapshot(),
      knifeVisible:Object.entries(this.knives??{}).filter(([,m])=>m.visible).map(([k])=>k),
      gun:position('j_gun'),knife:position('tag_knife_attach'),torso:this.hands?.getObjectByName('tag_torso')?.position.toArray()};
  }
}
