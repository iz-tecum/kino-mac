import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import * as THREE from 'three';
import {createDaylightGeometry} from './daylight-geometry.mjs';
import {surfaceReceivers} from '../export/web/theater-surface-light.js';
const root=path.resolve(import.meta.dirname,'../export/web');
const optical=createDaylightGeometry(root,{staticProps:true}),plan=JSON.parse(fs.readFileSync(path.join(root,'theater-light-plan.json')));
const size=512,width=size*2,height=size*3,bytes=new Uint8Array(width*height),sun=new THREE.Vector3(...plan.sun.direction).normalize(),ray=new THREE.Ray(new THREE.Vector3(),sun);
const start=performance.now(),regions=[];
for(const [i,region]of surfaceReceivers.entries()){
  const tile=[i%2,Math.floor(i/2)],[x,z,X,Z]=region.bounds;let lit=0,energy=0;
  for(let y=0;y<size;y++)for(let u=0;u<size;u++){
    ray.origin.set(x+(X-x)*u/(size-1),region.height+1.2,z+(Z-z)*y/(size-1));
    const light=optical.transmission(ray,.3,10000);bytes[(tile[1]*size+y)*width+tile[0]*size+u]=Math.round(light*255);lit+=light>0?1:0;energy+=light;
  }
  regions.push({...region,tile,litPixels:lit,meanTransmission:energy/(size*size)});
  console.log(JSON.stringify({region:region.id,litPixels:lit,seconds:(performance.now()-start)/1000}));
}
fs.writeFileSync(path.join(root,'environment/theater-surface-light.bin'),bytes);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const result={version:1,binary:'environment/theater-surface-light.bin',width,height,tileSize:size,regions,sunDirection:plan.sun.direction,color:plan.sun.color,energy:plan.sun.energy,method:'512-square optical direct-sun receiver tiles. Native opaque world and static furniture, alpha-tested broken boards/fences and glazing transmission. No geometry or collision changes. Dynamic actors/doors excluded.',geometry:optical.stats,provenance:{world:hash(fs.readFileSync(path.join(root,'kino.bin'))),gltf:hash(fs.readFileSync(path.join(root,'kino.gltf'))),binary:hash(bytes)},seconds:(performance.now()-start)/1000};
fs.writeFileSync(path.join(root,'theater-surface-light.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({geometry:optical.stats,seconds:result.seconds}));
