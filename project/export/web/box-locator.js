import * as THREE from 'three';
import { loadModel } from './animation.js';
import { restoreBoxLocatorDecals, disposeBoxLocatorDecals } from './box-locator-boards.js';

// Original map marker labels, in zombie_theater.csc's _box_locations order.
export const BOX_LOCATOR_LOCATIONS=Object.freeze(['start_chest_loc','foyer_chest_loc','crematorium_chest_loc','alleyway_chest_loc','control_chest_loc','stage_chest_loc','dressing_chest_loc','dining_chest_loc','theater_chest_loc']);

// Match compose_scene_t5.py: conjugate the native pitch/yaw/roll into Y-up.
// The lamps lie against vertical boards; using only entity.yaw leaves them hanging.
export function boxLocatorMatrix(entity){
  const [pitch,yaw,roll]=String(entity.angles??'0 0 0').split(/\s+/).map(n=>Number(n)*Math.PI/180);
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  const a=[cy*cp,sy*cp,-sp],b=[cy*sp*sr-sy*cr,sy*sp*sr+cy*cr,cp*sr],c=[cy*sp*cr+sy*sr,sy*sp*cr-cy*sr,cp*cr];
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(a[0],a[2],-a[1]),new THREE.Vector3(c[0],c[2],-c[1]),new THREE.Vector3(-b[0],-b[2],b[1])).scale(new THREE.Vector3().setScalar(Number(entity.modelscale)||1)).setPosition(...entity.position);
}

export function boxLocatorStatus(world,session,box){
  const location=world.activeBox?.script_noteworthy;
  const selected=location&&BOX_LOCATOR_LOCATIONS.includes(location+'_loc')?location+'_loc':null;
  const roll=box.boxes.get(world.activeBox?.id)?.roll;
  // Match the CSC's special-state branches: Fire Sale/movement are not power-gated.
  const mode=session.effects.fire_sale>session.time?'fire-sale':roll?.teddy&&roll.ready?'moving':session.power&&selected?'selected':'off';
  return {mode,selected,time:session.time};
}

export class BoxLocator {
  constructor(scene,data,world,session,mysteryBox,loader=loadModel){
    Object.assign(this,{scene,data,world,session,mysteryBox,loader});
    this.root=new THREE.Group();this.root.name='box_locator_boards';this.batches=[];this.markers=[];this.matrices=[];this.lit=[];this.mode='off';this.selected=null;this.phaseStart=0;this.lastTime=0;this.lastKey=null;
  }
  async load(){
    if(this.loaded)return;
    this.markers=this.data.entities.filter(e=>e.targetname==='magic_box_loc_light'&&BOX_LOCATOR_LOCATIONS.includes(e.script_noteworthy));
    if(!this.markers.length){this.loaded=true;return;}
    const template=await this.loader(this.data.models.zombie_zapper_cagelight);
    if(!template)throw new Error('Box locator native cage-light model is missing');
    template.updateMatrixWorld(true);
    const parts=[];template.traverse(o=>{if(o.isMesh)parts.push(o);});
    // Native asset has one body, one glass and one filament primitive. Instancing
    // retains its geometry/textures and needs at most five draws for all 81 lamps.
    for(const part of parts){
      if(Array.isArray(part.material))throw new Error('Unexpected multi-material box locator primitive');
      const illuminated=/mtl_glass|mtl_filament/.test(part.material.name);
      for(const on of illuminated?[false,true]:[false]){
        const material=part.material.clone();
        if(on){
          material.color.set(0x79b45e);material.emissive.set(0x5bc83b);
          material.emissiveMap=material.map;material.emissiveIntensity=/filament/.test(material.name)?2:1.1;
        }
        const mesh=new THREE.InstancedMesh(part.geometry,material,this.markers.length);
        mesh.name='box_locator_'+part.material.name.replace(/[^a-z0-9]/gi,'_')+(on?'_green':'_off');
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;
        this.root.add(mesh);this.batches.push({mesh,on,illuminated,local:part.matrixWorld.clone()});
      }
    }
    this.matrices=this.markers.map(boxLocatorMatrix);this.decals=restoreBoxLocatorDecals(this.scene);this.scene.add(this.root);this.loaded=true;this.reset();
  }
  update(reducedFlashes=false){
    if(!this.loaded)return;
    const state=boxLocatorStatus(this.world,this.session,this.mysteryBox);
    if(state.mode!==this.mode||state.time<this.lastTime)this.phaseStart=state.time;
    this.mode=state.mode;this.selected=state.selected;this.lastTime=state.time;
    const blink=this.mode==='moving'||this.mode==='fire-sale';
    const halfPeriod=this.mode==='moving'?.25:.3;
    // Source flash_lights waits one half-cycle before lighting the boards.
    const on=blink&&(reducedFlashes||Math.floor((state.time-this.phaseStart+1e-8)/halfPeriod)%2===1);
    const key=this.mode+':'+this.selected+':'+on;
    if(key===this.lastKey)return;
    this.lastKey=key;
    this.lit=this.markers.map(e=>this.mode==='selected'?e.script_noteworthy===this.selected:on);
    this.writeInstances();
  }
  writeInstances(){
    const matrix=new THREE.Matrix4();
    for(const batch of this.batches){
      let count=0;
      for(let i=0;i<this.markers.length;i++)if(!batch.illuminated||this.lit[i]===batch.on){
        matrix.multiplyMatrices(this.matrices[i],batch.local);batch.mesh.setMatrixAt(count++,matrix);
      }
      batch.mesh.count=count;batch.mesh.visible=count>0;batch.mesh.instanceMatrix.needsUpdate=true;
      batch.mesh.computeBoundingBox();batch.mesh.computeBoundingSphere();
    }
  }
  reset(){this.mode='off';this.selected=null;this.phaseStart=this.lastTime=Number(this.session.time)||0;this.lastKey=null;this.lit=this.markers.map(()=>false);this.writeInstances();}
  snapshot(){return {mode:this.mode,selected:this.selected,lamps:this.markers.length,lit:this.markers.filter((e,i)=>this.lit[i]).map(e=>e.id),groups:BOX_LOCATOR_LOCATIONS.map(location=>({location,count:this.markers.filter(e=>e.script_noteworthy===location).length})),batches:this.batches.map(({mesh})=>({name:mesh.name,id:mesh.id,count:mesh.count,geometry:mesh.geometry.uuid,material:mesh.material.uuid})),boardRepairs:{repositioned:this.markers.filter(e=>e.authoredPosition).length,decals:this.decals??null},positions:this.markers.map(e=>({id:e.id,position:e.position,authoredPosition:e.authoredPosition??null})),addedLights:0,greenMaterial:'Adapted native off glass and filament; exact green variant unavailable'};}
  dispose(){this.root.removeFromParent();for(const {mesh} of this.batches){mesh.material.dispose();mesh.dispose();}this.root.clear();disposeBoxLocatorDecals(this.scene);this.decals=null;this.batches=[];this.loaded=false;}
}
