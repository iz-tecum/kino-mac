import * as THREE from 'three';

// The recovered XAnims contain separate authored ADS raise/lower curves. The
// lower curves are not generally reversed raises (notably Stakeout/Ray Gun).
export class NativeAimPose {
  constructor(root, up, down) {
    this.tracks=[];this.direction=null;this.progress=0;
    const trackMap=new Map();
    for(const [side,data] of [['up',up],['down',down]])for(const bone of data?.bones??[]){
      const node=root.getObjectByName(bone.name);if(!node)continue;
      for(const [source,property,Track] of [['pos','position',THREE.VectorKeyframeTrack],['rot','quaternion',THREE.QuaternionKeyframeTrack]]){
        const value=bone[source];if(!value)continue;
        const key=node.uuid+property;
        if(!trackMap.has(key))trackMap.set(key,{node,property,source,last:null,offset:null});
        trackMap.get(key)[side]={duration:Math.max(data.duration,value.frames.at(-1)/data.fps),sample:new Track('',value.frames.map(f=>f/data.fps),value.values).createInterpolant()};
      }
    }
    this.tracks=[...trackMap.values()];
  }
  sample(track,progress,direction){
    const curve=(direction<0?track.down:track.up)??track.up??track.down;
    const time=curve===track.down?1-progress:progress;
    const value=track.property==='position'?new THREE.Vector3():new THREE.Quaternion();
    value.fromArray(curve.sample.evaluate(time*curve.duration));
    if(track.property==='quaternion')value.normalize();
    return value;
  }
  reset(){this.direction=null;this.progress=0;for(const track of this.tracks){track.last=null;track.offset=null;}}
  apply(progress,direction,{restOnly=false,clip=null}={}){
    progress=THREE.MathUtils.clamp(progress,0,1);
    const changed=this.direction!==null&&direction!==this.direction;
    const remaining=value=>direction>0?1-value:value;
    for(const track of this.tracks){
      if(restOnly){
        const bone=clip?.bones.find(b=>b.name===track.node.name);
        if(!bone?.[track.source])track.node[track.property].copy(this.sample(track,0,1));
        track.last=null;track.offset=null;continue;
      }
      if(changed&&track.last){
        // A mid-transition reversal must begin at the current pose, then join
        // the newly selected native curve continuously by its destination.
        const start=this.sample(track,this.progress,direction);
        track.offset=track.property==='position'?track.last.clone().sub(start):track.last.clone().multiply(start.invert()).normalize();
        track.remaining=remaining(this.progress);
      }
      const value=this.sample(track,progress,direction);
      if(track.offset){
        const weight=track.remaining>0?THREE.MathUtils.clamp(remaining(progress)/track.remaining,0,1):0;
        if(track.property==='position')value.addScaledVector(track.offset,weight);
        else value.premultiply(new THREE.Quaternion().slerp(track.offset,weight)).normalize();
        if(weight===0)track.offset=null;
      }
      track.node[track.property].copy(value);track.last=value;
    }
    this.direction=restOnly?null:direction;this.progress=restOnly?0:progress;
  }
}

// Dual-wield XAnims contain separate left/right bone sets AND notify tracks.
// Preserve both hands' magazine sounds, avoiding identical shared notifies.
export function mergeWeaponAnimations(primary,secondary,name){
  if(!primary||!secondary)return primary;
  const seen=new Set(),notifies=[];
  for(const notify of [...primary.notifies??[],...secondary.notifies??[]]){
    const key=notify.name+'@'+notify.time;if(seen.has(key))continue;
    seen.add(key);notifies.push(notify);
  }
  notifies.sort((a,b)=>a.time-b.time);
  return {...primary,name,duration:Math.max(primary.duration,secondary.duration),
    bones:[...primary.bones,...secondary.bones.filter(b=>!primary.bones.some(a=>a.name===b.name))],notifies};
}

export function dualWeaponAnimations(right,left){
  const entries=new Map(right);
  for(const key of ['idleAnim','emptyIdleAnim','fireAnim','lastShotAnim','reloadAnim','reloadEmptyAnim']){
    const primary=right.get(key);if(!primary)continue;
    const secondary=key.startsWith('reload')?
      (key==='reloadEmptyAnim'?left.get('reloadEmptyAnimLeft'):null)??left.get('reloadAnimLeft'):
      (key==='emptyIdleAnim'?left.get('emptyIdleAnimLeft'):null)??left.get('idleAnimLeft');
    if(secondary)entries.set(key,mergeWeaponAnimations(primary,secondary,primary.name+'-dual'));
  }
  for(const [key,leftKey] of [['leftFireAnim','fireAnimLeft'],['leftLastShotAnim','lastShotAnimLeft']]){
    if(left.has(leftKey))entries.set(key,mergeWeaponAnimations(left.get(leftKey),right.get('idleAnim'),'dual-'+key));
  }
  return [...entries];
}

// Reconcile one recovered AUG component's two native coordinate bases. In
// t5_weapon_aug_viewmodel.glb, tag_pump2 binds at -90deg Z, also used by the
// viewmodel_aug_masterkey[_mk]_sprint_* and mk_pullout_quick XAnims. The
// idle/fire/reload family instead stores the same static part at -90deg X.
// Applying that family directly turns the pump 120deg away from its socket.
// Retarget only those near-static samples; preserve authored translation,
// already matching clips, all arm tracks, and the unmodified cached JSON.
export function retargetAugPump(root,def,entries){
  if(!def.model?.endsWith('/t5_weapon_aug_viewmodel.glb')||def.hideTags?.includes('tag_pump2'))return entries;
  const pump=root.getObjectByName('tag_pump2');if(!pump)return entries;
  const bind=pump.quaternion.clone().normalize();
  const source=new THREE.Quaternion(-Math.SQRT1_2,0,0,Math.SQRT1_2);
  const target=new THREE.Quaternion(0,0,-Math.SQRT1_2,Math.SQRT1_2);
  const sprint=entries.find(([key])=>key==='sprintInAnim')?.[1].bones.find(b=>b.name==='tag_pump2')?.rot;
  if(bind.angleTo(target)>.001||!sprint||bind.angleTo(new THREE.Quaternion().fromArray(sprint.values).normalize())>.001)return entries;
  const correction=bind.clone().multiply(source.clone().invert()),sample=new THREE.Quaternion();
  return entries.map(([key,clip])=>{
    const part=clip.bones.find(b=>b.name==='tag_pump2');if(!part?.rot)return [key,clip];
    for(let i=0;i<part.rot.values.length;i+=4)if(source.angleTo(sample.fromArray(part.rot.values,i).normalize())>.001)return [key,clip];
    const values=[];
    for(let i=0;i<part.rot.values.length;i+=4)sample.fromArray(part.rot.values,i).normalize().premultiply(correction).normalize().toArray(values,i);
    return [key,{...clip,bones:clip.bones.map(b=>b===part?{...part,rot:{...part.rot,values}}:b)}];
  });
}

// Tube-loading shotgun/launcher viewmodels carry a separate shell on tag_clip.
// Native idle XAnims retain its staging pose; rendering that reload-only prop
// outside insertion produces a loose round floating above the Stakeout.
export class ReloadPropVisibility {
  constructor(root,def,clips){
    this.parts=[];this.visible=false;
    // The AUG Masterkey uses tag_ammo2; tag_clip is its rifle magazine and
    // must remain attached. Select the prop actually animated by reloads.
    const animated=new Set(clips.filter(([key])=>key.startsWith('reload')).flatMap(([,clip])=>clip.bones.filter(b=>b.pos?.frames.length>1).map(b=>b.name)));
    if(def.segmentedReload&&(def.pellets>1||(def.projectileSpeed>0&&def.projectileType==='grenade')))root.traverse(node=>{
      if(node.isBone&&/^tag_(clip\d?|ammo2)$/.test(node.name)&&animated.has(node.name)&&!def.hideTags?.includes(node.name))this.parts.push({node,scale:node.scale.clone()});
    });
    this.set(false);
  }
  set(visible){this.visible=visible;for(const {node,scale} of this.parts)node.scale.copy(scale).multiplyScalar(visible?1:.000001);}
  begin(stage){this.set(stage!=='end');}
  notify(name){if(name==='rmbnt#reload_clipin'||(name.startsWith('sndnt#')&&name.endsWith('_shell_in')))this.set(false);}
  snapshot(){return {visible:this.visible&&this.parts.length>0,tags:this.parts.map(p=>p.node.name)};}
}
