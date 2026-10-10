import * as THREE from 'three';
import {surfaceReceivers} from './theater-surface-light.js';

const fallback = [.10,.115,.13], down = new THREE.Vector3(0,-1,0), up = new THREE.Vector3(0,1,0);
const cellSize = 64;
function regionFor(position, margin=3) {
  let best=-1,distance=margin;
  for(const [i,r]of surfaceReceivers.entries()){const d=Math.abs(position.y-r.height);if(d>=distance||(margin>3&&r.height>position.y+6)||position.x<r.bounds[0]||position.x>r.bounds[2]||position.z<r.bounds[1]||position.z>r.bounds[3])continue;best=i;distance=d;}
  return best;
}
const keyFor=(r,x,z)=>`${r}:${Math.floor(x/cellSize)}:${Math.floor(z/cellSize)}`;

/** Compact spatial averages of existing floor irradiance, never a new bake.
 * Floors transfer a restrained diffuse bounce estimate to moving actors. */
export function collectActorProbes(scene, scale=4) {
  const cells=new Map(),position=new THREE.Vector3(),normal=new THREE.Vector3(),matrix=new THREE.Matrix3();
  scene.updateMatrixWorld(true);
  scene.traverse(mesh=>{
    if(!mesh.isMesh||mesh.isInstancedMesh||mesh.isSkinnedMesh||!mesh.visible)return;
    const a=mesh.geometry.attributes;if(!a.kinoBaseLight||!a.normal)return;
    matrix.getNormalMatrix(mesh.matrixWorld);
    for(let i=0;i<a.position.count;i++){
      normal.fromBufferAttribute(a.normal,i).applyMatrix3(matrix).normalize();if(normal.y<.94)continue;
      position.fromBufferAttribute(a.position,i).applyMatrix4(mesh.matrixWorld);const region=regionFor(position);if(region<0)continue;
      const key=keyFor(region,position.x,position.z);let c=cells.get(key);if(!c){c={region,x:0,z:0,n:0,base:[0,0,0],power:[0,0,0]};cells.set(key,c);}c.x+=position.x;c.z+=position.z;c.n++;
      for(let j=0;j<3;j++){c.base[j]+=Math.max(0,a.kinoBaseLight.getComponent(i,j)-(a.kinoSolarLight?.getComponent(i,j)||0))*scale;c.power[j]+=(a.kinoPowerLight?.getComponent(i,j)||0)*scale;}
    }
  });
  for(const c of cells.values()){c.x/=c.n;c.z/=c.n;for(let j=0;j<3;j++){c.base[j]/=c.n;c.power[j]/=c.n;}}
  return cells;
}

export function sampleActorBounce(cells, region, position, power=0) {
  const x=Math.floor(position.x/cellSize),z=Math.floor(position.z/cellSize),sum=[0,0,0];let total=0;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    const c=cells.get(`${region}:${x+dx}:${z+dz}`);if(!c)continue;
    const weight=1/(64+(c.x-position.x)**2+(c.z-position.z)**2);total+=weight;
    for(let j=0;j<3;j++)sum[j]+=(c.base[j]*.45+c.power[j]*power*.35)*weight;
  }
  return total?sum.map((v,j)=>THREE.MathUtils.clamp(v/total+fallback[j]*.35,fallback[j]*.65,.65)):fallback.slice();
}

/** Project an actor-height point down the original sun vector onto an existing
 * receiver. This reuses the static visibility atlas: a conservative approximation
 * where static obstacles below the actor can also shadow its projected sample. */
export function sampleActorSun(field, region, position, height=32) {
  if(region<0||!field?.texture?.image?.data)return 0;
  const p=field.plan,r=p.regions[region],sun=p.sunDirection;if(!r||sun[1]<=.01)return 0;
  const y=position.y+height-r.height,x=position.x-y*sun[0]/sun[1],z=position.z-y*sun[2]/sun[1],b=r.bounds;
  const u=(x-b[0])/(b[2]-b[0]),v=(z-b[1])/(b[3]-b[1]);if(u<0||u>1||v<0||v>1)return 0;
  const sx=r.tile[0]*p.tileSize+u*(p.tileSize-1),sy=r.tile[1]*p.tileSize+v*(p.tileSize-1),ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,raw=field.texture.image.data;
  const at=(x,y)=>raw[Math.min(p.height-1,y)*p.width+Math.min(p.width-1,x)]/255;
  return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
}

export function installActorProbeMaterial(material, uniforms) {
  if(!material?.isMeshStandardMaterial)return material;
  const prior=material.onBeforeCompile,shade=material.clone();shade.userData={...material.userData,kinoSpatialActorProbe:true};
  shade.onBeforeCompile=shader=>{
    prior.call(material,shader);
    shader.uniforms.kinoActorAmbient=uniforms.ambient;shader.uniforms.kinoActorSun=uniforms.sun;shader.uniforms.kinoActorSunDirection=uniforms.direction;
    shader.fragmentShader='uniform vec3 kinoActorAmbient;uniform vec3 kinoActorSun;uniform vec3 kinoActorSunDirection;\n'+shader.fragmentShader;
    // Replace the established v1.4 constant, retaining any unrelated source hook.
    shader.fragmentShader=shader.fragmentShader.replace('irradiance += PI * vec3(.10,.115,.13);','');
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n#if defined(RE_IndirectDiffuse)\nirradiance += PI * (kinoActorAmbient + kinoActorSun * max(0.,dot(normal,normalize((viewMatrix*vec4(kinoActorSunDirection,0.)).xyz))));\n#endif');
  };
  shade.customProgramCacheKey=()=> 'kino-spatial-actor-probe-v1';return shade;
}

export function verifyContactFloor(world, position, region, radius) {
  if(region<0)return null;const y=surfaceReceivers[region].height,normal=new THREE.Vector3();
  if(position.y<y-5||position.y>y+58)return null;
  for(const [x,z]of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]){
    const ray=new THREE.Ray(new THREE.Vector3(position.x+x,y+22,position.z+z),down),hit=world.raycast(ray,0,48);
    const point=hit?.point||hit?.position;if(!point||Math.abs(point.y-y)>1.5||!hit.triangle)return null;
    hit.triangle.getNormal(normal);if(normal.y<.95)return null;
  }
  return y;
}

export class TheaterActors {
  constructor(scene,world,{capacity=36}={}) {
    this.scene=scene;this.world=world;this.capacity=Math.min(36,Math.max(1,capacity));this.records=new Map();this.lastTime=null;this.cursor=0;
    this.probes=collectActorProbes(scene,world.lightfield?.manifest?.scale||4);this.field=world.surfaceSunlight;
    this.direction=new THREE.Vector3(...(this.field?.plan.sunDirection||[.179,.754,.633])).normalize();this.sunColor=new THREE.Color(...(this.field?.plan.color||[.91,.86,.73]));this.matrix=new THREE.Matrix4();this.quaternion=new THREE.Quaternion();this.scale=new THREE.Vector3();this.position=new THREE.Vector3();
    const geometry=new THREE.PlaneGeometry(2,2).rotateX(-Math.PI/2);this.opacity=new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1);geometry.setAttribute('contactOpacity',this.opacity);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
      vertexShader:'attribute float contactOpacity;varying vec2 contactUV;varying float amount;void main(){contactUV=uv*2.-1.;amount=contactOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 contactUV;varying float amount;void main(){float r=dot(contactUV,contactUV);if(r>=1.)discard;float a=pow(1.-r,2.2)*amount;gl_FragColor=vec4(0.,0.,0.,a);}' });
    this.shadows=new THREE.InstancedMesh(geometry,material,this.capacity);this.shadows.name='Pooled actor floor contact';this.shadows.count=0;this.shadows.frustumCulled=false;this.shadows.renderOrder=3;this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(this.shadows);
    this.stats={probeCells:this.probes.size,actors:0,shadows:0,floorChecks:0,rayBudget:0,materials:0,quality:'balanced'};
  }
  attach(actor) {
    const uniforms={ambient:{value:new THREE.Color(...fallback)},sun:{value:new THREE.Color(0,0,0)},direction:{value:this.direction}},variants=new Map(),meshes=[];
    actor.root.traverse(mesh=>{if(!mesh.isMesh)return;const original=mesh.material;const apply=m=>{if(!variants.has(m))variants.set(m,installActorProbeMaterial(m,uniforms));return variants.get(m);};mesh.material=Array.isArray(original)?original.map(apply):apply(original);meshes.push({mesh,original});});
    const record={actor,uniforms,variants,meshes,ambient:fallback.slice(),ambientTarget:new THREE.Color(...fallback),sunTarget:new THREE.Color(0,0,0),sun:0,region:-1,floor:null,checkedAt:-Infinity,checkedPosition:new THREE.Vector3(Infinity,Infinity,Infinity)};this.records.set(actor.id,record);return record;
  }
  release(record) {for(const {mesh,original}of record.meshes)mesh.material=original;for(const [original,shade]of record.variants)if(shade!==original)shade.dispose();this.records.delete(record.actor.id);}
  update(enemies,viewer,time,{quality='balanced'}={}) {
    const dt=this.lastTime===null?1:Math.max(0,Math.min(.1,time-this.lastTime));this.lastTime=time;
    const actors=[...enemies.list,...enemies.dead].filter(a=>a.root.visible).sort((a,b)=>a.root.position.distanceToSquared(viewer)-b.root.position.distanceToSquared(viewer)).slice(0,this.capacity),ids=new Set(actors.map(a=>a.id));
    if(dt===0&&quality===this.stats.quality&&actors.length===this.records.size&&actors.every(a=>this.records.has(a.id)))return;
    for(const record of [...this.records.values()])if(!ids.has(record.actor.id))this.release(record);
    for(const actor of actors)if(!this.records.has(actor.id))this.attach(actor);
    const interval=quality==='performance'?.32:.18,maxChecks=quality==='performance'?1:2,shadowLimit=quality==='performance'?8:this.capacity;let checks=0;
    for(let n=0;n<actors.length&&checks<maxChecks;n++){
      const actor=actors[(this.cursor+n)%actors.length],r=this.records.get(actor.id),p=actor.root.position;if(time-r.checkedAt<interval)continue;
      r.checkedAt=time;r.checkedPosition.copy(p);r.region=regionFor(p,60);r.floor=null;
      r.ambient=sampleActorBounce(this.probes,r.region,p,this.world.lightfield?.power.value||0);
      r.sun=sampleActorSun(this.field,r.region,p,actor.kind==='zombie'?34:18);
      r.ambientTarget.fromArray(r.ambient);r.sunTarget.copy(this.sunColor).multiplyScalar(r.sun*(this.field?.plan.energy||1.35));
      if(p.distanceToSquared(viewer)<650**2&&!['barricade','entering'].includes(actor.state))r.floor=verifyContactFloor(this.world,p,r.region,actor.kind==='dog'?20:14);
      checks++;
    }
    this.cursor=actors.length?(this.cursor+maxChecks)%actors.length:0;
    let count=0,materials=0;const blend=1-Math.exp(-dt*12);
    for(const actor of actors){const r=this.records.get(actor.id),p=actor.root.position;materials+=r.variants.size;
      r.uniforms.ambient.value.lerp(r.ambientTarget,blend);r.uniforms.sun.value.lerp(r.sunTarget,blend);
      if(count>=shadowLimit||r.floor===null||p.distanceToSquared(r.checkedPosition)>32**2||p.y<r.floor-2||p.y>r.floor+58)continue;
      const radius=actor.kind==='dog'?23:actor.kind==='nova'?19:16,fade=THREE.MathUtils.clamp(1-Math.max(0,p.y-r.floor-4)/54,0,1)*(actor.state==='dead'?Math.min(1,actor.life/2):1);
      this.position.set(p.x,r.floor+.2,p.z);this.quaternion.setFromAxisAngle(up,-actor.root.rotation.y);this.scale.set(radius,1,radius*.78);this.matrix.compose(this.position,this.quaternion,this.scale);this.shadows.setMatrixAt(count,this.matrix);this.opacity.setX(count,.34*fade);count++;
    }
    this.shadows.count=count;this.shadows.visible=count>0;this.shadows.instanceMatrix.needsUpdate=true;this.opacity.needsUpdate=true;
    Object.assign(this.stats,{actors:actors.length,shadows:count,floorChecks:checks,rayBudget:maxChecks*5,materials,quality});
  }
  reset(){for(const r of [...this.records.values()])this.release(r);this.shadows.count=0;this.shadows.visible=false;this.lastTime=null;this.cursor=0;this.stats.actors=this.stats.shadows=this.stats.materials=0;}
  sampleIllumination(feet,{height=32,power=this.world.lightfield?.power.value||0}={}){const region=regionFor(feet,60);return {region,ambient:sampleActorBounce(this.probes,region,feet,power),sunVisibility:sampleActorSun(this.field,region,feet,height),sunColor:this.sunColor.toArray(),sunEnergy:this.field?.plan.energy||1.35};}
  snapshot(){return {...this.stats,drawCalls:this.shadows.visible?1:0,triangles:this.shadows.count*2,samples:[...this.records.values()].slice(0,8).map(r=>({id:r.actor.id,kind:r.actor.kind,region:r.region,sun:r.sun,ambient:r.ambient,contact:r.floor!==null}))};}
  dispose(){this.reset();this.shadows.removeFromParent();this.shadows.geometry.dispose();this.shadows.material.dispose();}
}
