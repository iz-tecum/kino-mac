import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {deserializeCollisionWorld} from '../export/web/collision-world.js';
import {geometryFingerprint} from '../export/web/environment-occlusion.js';
import {createDaylightGeometry} from './daylight-geometry.mjs';
import {lightFalloff} from '../export/web/theater-light-field.js';
const root=path.resolve(import.meta.dirname,'../export/web'),doc=JSON.parse(fs.readFileSync(path.join(root,'kino.gltf')));
const raw=fs.readFileSync(path.join(root,'kino.bin')),cb=fs.readFileSync(path.join(root,'collision.bin'));
const collision=deserializeCollisionWorld(JSON.parse(fs.readFileSync(path.join(root,'collision.json'))),cb.buffer.slice(cb.byteOffset,cb.byteOffset+cb.byteLength));
const plan=JSON.parse(fs.readFileSync(path.join(root,'theater-light-plan.json'))),ao=JSON.parse(fs.readFileSync(path.join(root,'environment-occlusion.json')));
const optical=createDaylightGeometry(root);
const sky=Array.from({length:plan.sky?.samples??9},(_,i)=>{const y=(i+.5)/(plan.sky?.samples??9),a=i*2.39996323,r=Math.sqrt(1-y*y);return new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);});
const pos=new THREE.Vector3(),normal=new THREE.Vector3(),delta=new THREE.Vector3(),ray=new THREE.Ray(),sun=new THREE.Vector3(...plan.sun.direction).normalize();
const cache=new Map(),geometry={},chunks=[],solarChunks=[];let offset=0,rays=0,vertices=0;const start=performance.now(),scale=4;
function attribute(i){const a=doc.accessors[i],v=doc.bufferViews[a.bufferView];if(a.componentType!==5126||v.byteStride)throw Error('Unexpected geometry');return new THREE.BufferAttribute(new Float32Array(raw.buffer,raw.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*3),3);}
for(const primitive of doc.meshes.find(m=>m.name==='world_shell').primitives){
  const p=attribute(primitive.attributes.POSITION),n=attribute(primitive.attributes.NORMAL),key=geometryFingerprint(p,n);
  if(!ao.geometry[key]||geometry[key])continue;
  const bytes=new Uint8Array(p.count*6),solarBytes=new Uint8Array(p.count*3);
  for(let i=0;i<p.count;i++){
    pos.fromBufferAttribute(p,i);normal.fromBufferAttribute(n,i).normalize();
    const ck=`${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}:${normal.x.toFixed(2)},${normal.y.toFixed(2)},${normal.z.toFixed(2)}`;
    let value=cache.get(ck);
    if(!value){
      const light=[0,0,0,0,0,0],solar=[0,0,0];ray.origin.copy(pos).addScaledVector(normal,2.6);
      for(const source of plan.sources){
        const amount=lightFalloff(source,pos,normal);if(amount<.004)continue;
        delta.fromArray(source.position).sub(ray.origin);const distance=delta.length();ray.direction.copy(delta).divideScalar(distance);rays++;
        if(collision.bvh.raycastFirst(ray,THREE.DoubleSide,.3,Math.max(.4,distance-8)))continue;
        if(!optical.visible(ray,.3,Math.max(.4,distance-8)))continue;
        const at=source.powered?3:0;for(let c=0;c<3;c++)light[at+c]+=source.color[c]*amount;
      }
      const sunAmount=Math.max(0,normal.dot(sun))*plan.sun.energy;
      if(sunAmount>.01){ray.direction.copy(sun);rays++;const transmission=optical.transmission(ray,.4,10000);for(let c=0;c<3;c++){solar[c]=plan.sun.color[c]*sunAmount*transmission;light[c]+=solar[c];}}
      // Uniform upper-hemisphere integration: geometry, cutout roofs and real
      // glazing determine the sky contribution, never physics-only clips.
      for(const direction of sky){const facing=Math.max(0,normal.dot(direction));if(facing<.02)continue;ray.direction.copy(direction);rays++;const transmission=optical.transmission(ray,.4,10000);for(let c=0;c<3;c++)light[c]+=(plan.sky?.color[c]??.6)*(plan.sky?.energy??.72)*2*facing*transmission/sky.length;}
      value={light:light.map(v=>Math.round(Math.min(1,v/scale)*255)),solar:solar.map(v=>Math.round(Math.min(1,v/scale)*255))};cache.set(ck,value);
    }
    bytes.set(value.light,i*6);solarBytes.set(value.solar,i*3);
  }
  geometry[key]={offset,count:p.count,sourceMaterial:ao.geometry[key].sourceMaterial};chunks.push(Buffer.from(bytes));solarChunks.push(Buffer.from(solarBytes));offset+=bytes.length;vertices+=p.count;
  if(chunks.length%16===0)console.log(JSON.stringify({groups:chunks.length,vertices,rays,seconds:(performance.now()-start)/1000}));
}
const solarBinary=Buffer.concat(solarChunks);fs.writeFileSync(path.join(root,'environment/theater-solar.bin'),solarBinary);
const binary=Buffer.concat(chunks),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
fs.writeFileSync(path.join(root,'environment/theater-irradiance.bin'),binary);
const manifest={version:1,binary:'environment/theater-irradiance.bin',byteLength:binary.length,solarBinary:'environment/theater-solar.bin',solarByteLength:solarBinary.length,scale,geometry,plan,
  method:'Reconstructed diffuse irradiance from native fixtures, direct sun and nine occluded sky directions. Optical world-shell visibility includes solid ceilings, sampled roof/fence cutouts and attenuated glazing; local fixtures additionally respect collision. Separate always-on and powered RGB fields. Static props and dynamic doors are not solar shadow casters. Not original T5 lightmaps.',
  opticalGeometry:optical.stats,stats:{groups:chunks.length,vertices,uniqueSamples:cache.size,raycasts:rays,seconds:(performance.now()-start)/1000},
  provenance:{worldSha256:hash(raw),collisionSha256:hash(cb),planSha256:hash(fs.readFileSync(path.join(root,'theater-light-plan.json'))),outputSha256:hash(binary)}};
fs.writeFileSync(path.join(root,'theater-irradiance.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest.stats));
