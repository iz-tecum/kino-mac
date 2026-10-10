import fs from 'node:fs';import path from 'node:path';import * as THREE from 'three';
import {createDaylightGeometry} from './daylight-geometry.mjs';
import {surfaceReceivers} from '../export/web/theater-surface-light.js';
const optics=createDaylightGeometry(path.resolve(import.meta.dirname,'../export/web')),report=[];
for(const receiver of surfaceReceivers){const [x,z,X,Z]=receiver.bounds,points=[];
  for(let i=0;i<7;i++)for(let j=0;j<7;j++){
    const origin=[x+(X-x)*(i+.5)/7,receiver.height+40,z+(Z-z)*(j+.5)/7];
    const hit=optics.firstHit(new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(0,-1,0)),.1,150);
    if(hit&&hit.face.normal.y>.95)points.push({position:hit.point.toArray(),material:hit.material,normalY:hit.face.normal.y});
  }
  const histogram={};for(const p of points){const h=Math.round(p.position[1]);histogram[h]=(histogram[h]||0)+1;}
  report.push({id:receiver.id,bounds:receiver.bounds,configuredHeight:receiver.height,histogram,points});
}
const output=process.argv[2]||path.resolve(import.meta.dirname,'../../../references-v5/floor-height-audit-current.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.map(({id,configuredHeight,histogram})=>({id,configuredHeight,histogram})),null,2));
