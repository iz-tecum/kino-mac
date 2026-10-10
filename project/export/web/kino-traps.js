import * as THREE from 'three';

const up=new THREE.Vector3(0,1,0);
const arcStart=new THREE.Vector3(),arcEnd=new THREE.Vector3(),arcDirection=new THREE.Vector3(),arcCenter=new THREE.Vector3(),arcScale=new THREE.Vector3(1,1,1),arcRotation=new THREE.Quaternion(),arcMatrix=new THREE.Matrix4();
// Timings/fire contact follow supplied maps/_zombiemode_traps.gsc. Its README
// explicitly says the mod changes electric Juggernog damage 16 -> 25 and
// removes the <=100-health lethal rule. Keep Classic electric behavior here;
// the optional recovery profile does not opt into other Reimagined rules.
export const KINO_TRAP_RULES=Object.freeze({cost:1000,duration:40,cooldown:60,damageInterval:.1,electricJuggernogDamage:16,fireJuggernogDamage:25});
export function trapPlayerDamage(type,health,juggernog,rules=KINO_TRAP_RULES){
  if(!juggernog||(type==='electric'&&health<=100))return health+100;
  return type==='electric'?rules.electricJuggernogDamage:rules.fireJuggernogDamage;
}
// Trigger dimensions and emitter positions are native map entities; visual
// electricity/flame ribbons are bounded original replacements for T5 effects.
export class KinoTraps {
  constructor({scene,data,session,world,enemies,player,audio,damage}){
    Object.assign(this,{scene,data,session,world,enemies,player,audio,damage});this.traps=new Map();this.rules={...KINO_TRAP_RULES,...data.rules?.traps};this.nextDamage=0;
    for(const e of data.entities.filter(e=>e.targetname==='zombie_trap'&&e.bounds)){
      const bounds=new THREE.Box3(new THREE.Vector3(...e.bounds[0]),new THREE.Vector3(...e.bounds[1]));
      const sources=data.entities.filter(n=>n.classname==='script_struct'&&n.targetname===e.target).map(n=>new THREE.Vector3(...n.position));
      if(!sources.length)sources.push(bounds.getCenter(new THREE.Vector3()).setY(bounds.min.y));
      const fire=e.script_noteworthy==='fire',vertices=new Float32Array(sources.length*8*3);
      // World-space cores remain legible on Retina displays, where native WebGL
      // lines are limited to a single device pixel. All segments share one draw.
      const geometry=fire?new THREE.BufferGeometry():new THREE.CylinderGeometry(1.1,1.1,1,5,1,false);
      if(fire)geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3).setUsage(THREE.DynamicDrawUsage));
      const material=fire?new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{pixelHeight:{value:900}},
        vertexShader:'uniform float pixelHeight;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(pixelHeight*20./max(1.,-p.z),2.,70.);}',
        fragmentShader:'void main(){vec2 p=gl_PointCoord-.5;p.x*=1.7;float a=max(0.,1.-length(p)*2.);if(a<.01)discard;gl_FragColor=vec4(mix(vec3(1.,.15,.01),vec3(1.,.7,.16),a),a*a*.55);}'
      }):new THREE.MeshBasicMaterial({color:0x9edcff,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
      const mesh=fire?new THREE.Points(geometry,material):new THREE.InstancedMesh(geometry,material,sources.length*4);
      if(!fire)mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled=false;mesh.visible=false;mesh.name=e.target+' effect';scene.add(mesh);
      this.traps.set(e.target,{name:e.target,type:fire?'fire':'electric',bounds,sources,mesh,vertices,end:0,cooldown:0,nextEffect:0});
    }
  }
  prompt(name){const t=this.traps.get(name);if(!t)return null;const s=this.session;return !s.power?'The power must be activated':t.end>s.time?'Trap active · '+Math.ceil(t.end-s.time)+'s':t.cooldown>s.time?'Trap cooling down · '+Math.ceil(t.cooldown-s.time)+'s':`Activate ${t.type==='fire'?'fire':'electric'} trap · ${this.rules.cost}`;}
  activate(name){
    const t=this.traps.get(name),s=this.session;
    if(!t||s.busy||!s.power||t.cooldown>s.time||!s.spend(this.rules.cost))return false;
    t.end=s.time+this.rules.duration;t.cooldown=t.end+this.rules.cooldown;t.nextEffect=0;t.mesh.visible=true;this.audio.playAt('buy',t.sources[0],.7);t.sound?.stop();t.sound=this.audio.trapLoop?.(t.type,t.bounds.getCenter(new THREE.Vector3()),.3);return true;
  }
  affects(t,feet,height=60,radius=14){
    const actor=new THREE.Box3(feet.clone().add(new THREE.Vector3(-radius,1,-radius)),feet.clone().add(new THREE.Vector3(radius,height,radius)));
    if(!t.bounds.intersectsBox(actor))return false;
    const target=feet.clone().addScaledVector(up,Math.min(height*.5,30));
    return t.sources.some(source=>this.world.lineClear(source.clone().addScaledVector(up,30),target));
  }
  update(dt,reducedFlashes=false,pixelHeight=900){
    const time=this.session.time;
    for(const t of this.traps.values()){
      t.mesh.visible=t.end>time;if(!t.mesh.visible){t.sound?.stop();t.sound=null;continue;}
      for(const z of [...this.enemies.list])if(this.affects(t,z.root.position,z.kind==='zombie'?65:30,14))this.enemies.hurt(z,99999,false,false,t.type,false);
      if(time>=this.nextDamage&&this.affects(t,this.player.getFeetPosition())){this.nextDamage=time+this.rules.damageInterval;this.damage(trapPlayerDamage(t.type,this.session.health,this.session.perks.has('specialty_armorvest'),this.rules),t.sources[0]);}
      if(time<t.nextEffect)continue;t.nextEffect=time+(reducedFlashes?.16:.075);
      const positions=t.vertices;
      t.sources.forEach((source,i)=>{
        if(t.type==='fire'){
          t.mesh.material.uniforms.pixelHeight.value=pixelHeight;
          for(let k=0;k<8;k++){const f=(time*.7+k/8+i*.173)%1;new THREE.Vector3(source.x+Math.sin(time*3+i+k)*(2+f*5),source.y+f*130,source.z+Math.cos(time*4+i+k)*(2+f*5)).toArray(positions,(i*8+k)*3);}
          return;
        }
        const points=[];for(let k=0;k<5;k++){const fraction=k/4,height=Math.min(130,t.bounds.max.y-source.y);points.push(source.clone().add(new THREE.Vector3(Math.sin(time*23+i*7+k*3)*(t.type==='fire'?8:5)*Math.sin(fraction*Math.PI),height*fraction,Math.cos(time*19+i*5+k)*(t.type==='fire'?8:5)*Math.sin(fraction*Math.PI))));}
        for(let k=0;k<4;k++){points[k].toArray(positions,(i*8+k*2)*3);points[k+1].toArray(positions,(i*8+k*2+1)*3);}
      });
      if(t.type==='fire')t.mesh.geometry.attributes.position.needsUpdate=true;
      else{
        t.mesh.material.opacity=reducedFlashes?.55:.65+Math.sin(time*13)*.15;
        for(let i=0;i<t.mesh.count;i++){
          arcStart.fromArray(positions,i*6);arcEnd.fromArray(positions,i*6+3);arcDirection.subVectors(arcEnd,arcStart);
          const length=arcDirection.length();arcCenter.addVectors(arcStart,arcEnd).multiplyScalar(.5);arcScale.set(1,length,1);
          arcRotation.setFromUnitVectors(up,arcDirection.multiplyScalar(1/Math.max(length,.0001)));arcMatrix.compose(arcCenter,arcRotation,arcScale);t.mesh.setMatrixAt(i,arcMatrix);
        }
        t.mesh.instanceMatrix.needsUpdate=true;
      }
    }
  }
  reset(){this.nextDamage=0;for(const t of this.traps.values()){t.end=t.cooldown=t.nextEffect=0;t.mesh.visible=false;t.sound?.stop();t.sound=null;}}
  snapshot(){return [...this.traps.values()].map(t=>({name:t.name,type:t.type,active:t.end>this.session.time,remaining:Math.max(0,t.end-this.session.time),cooldown:Math.max(0,t.cooldown-this.session.time),bounds:[t.bounds.min.toArray(),t.bounds.max.toArray()],emitters:t.sources.length,visible:t.mesh.visible,objectId:t.mesh.id,geometryId:t.mesh.geometry.id,vertexCount:t.mesh.geometry.attributes.position.count,instanceCount:t.mesh.isInstancedMesh?t.mesh.count:0}));}
}
