import fs from 'node:fs';import path from 'node:path';import * as THREE from 'three';import {createDaylightGeometry} from './daylight-geometry.mjs';
const root=path.resolve(import.meta.dirname,'../export/web'),out=path.resolve(process.env.KINO_DAYLIGHT_AUDIT??'../../references-v4');const optics=createDaylightGeometry(root),old=JSON.parse(fs.readFileSync(path.join(out,'daylight-geometry.json'))),sun=new THREE.Vector3(...old.sunDirection).normalize();
const round=a=>a.map(x=>+x.toFixed(3)),candidates=[];
// Exact native front-pane bounds, not the entire wall. Fragmented panes keep
// their native material rather than treating the whole bounding box as open.
for(const patch of old.patches.filter(p=>p.material.includes('glass')&&p.center[2]>1490&&p.center[2]<1500&&Math.abs(p.center[0])<300&&p.center[1]>200&&Math.abs(p.normal[2])>.9)){
 const min=patch.bounds.min,max=patch.bounds.max;candidates.push({id:'lobby-front-'+patch.id,room:'Lobby',type:'native-glass-pane',center:patch.center,normal:[0,0,1],tangent:[1,0,0],width:max[0]-min[0],height:max[1]-min[1],bias:3,spacing:8,sourcePatch:patch.id,sourceMaterial:patch.material,nativeBounds:patch.bounds});
}
for(const c of [
 {id:'lobby-ceiling-damage',room:'Lobby',center:[320,532,920],width:240,height:340,bias:40},
 {id:'lobby-east-breach',room:'Lobby edge',center:[460,532,1190],width:150,height:160,bias:160},
 {id:'theater-roof-west',room:'Theater',center:[-270,936,-580],width:320,height:300,bias:140},
 {id:'theater-roof-east',room:'Theater',center:[240,936,-350],width:360,height:460,bias:140},
 {id:'vip-roof-breach',room:'Upper hall / VIP',center:[1060,464,860],width:620,height:420,bias:70},
 {id:'dining-roof-damage',room:'Speed Cola room',center:[1410,620,-420],width:650,height:720,bias:180},
 {id:'dressing-small-breach',room:'Dressing room',center:[1220,160,-1480],width:200,height:200,bias:60},
 {id:'alley-sky',room:'Alley',center:[-1570,500,-540],width:300,height:540,bias:430},
])candidates.push({...c,type:'sampled-roof-or-sky-region',normal:[0,1,0],tangent:[1,0,0],spacing:16,boundsAreSampleEnvelope:true});
function blockingHit(ray){let near=.3;for(let i=0;i<48;i++){const h=optics.firstHit(ray,near,10000);if(!h)return null;if(h.transmission===0)return{point:round(h.point.toArray()),distance:+h.distance.toFixed(3),material:h.material};near=h.distance+.02;}return{layerLimit:true};}
for(const c of candidates){const n=new THREE.Vector3(...c.normal),u=new THREE.Vector3(...c.tangent),v=new THREE.Vector3().crossVectors(n,u),center=new THREE.Vector3(...c.center),samples=[];let tests=0;const bounds=new THREE.Box3();
 for(let x=-c.width/2+c.spacing/2;x<c.width/2;x+=c.spacing)for(let y=-c.height/2+c.spacing/2;y<c.height/2;y+=c.spacing){const plane=center.clone().addScaledVector(u,x).addScaledVector(v,y),p=plane.clone().addScaledVector(n,-c.bias),sunRay=new THREE.Ray(p,sun),normalRay=new THREE.Ray(p,n),direct=optics.transmission(sunRay),sky=optics.transmission(normalRay);tests++;
  if(direct<=0&&sky<=0)continue;const tSun=c.bias/Math.max(.001,sun.dot(n)),sunAperture=p.clone().addScaledVector(sun,tSun);const landing=direct?blockingHit(new THREE.Ray(sunAperture.clone().addScaledVector(sun,-3),sun.clone().negate())):null;
  const nearSun=optics.firstHit(sunRay),firstMaterial=nearSun?.material??null;samples.push({probe:round(p.toArray()),planePoint:round(plane.toArray()),sunPlanePoint:direct?round(sunAperture.toArray()):null,sunTransmission:direct,skyTransmission:sky,firstMaterial,landing});bounds.expandByPoint(plane);
 }
 c.samples=samples;c.tested=tests;c.sunVisible=samples.filter(s=>s.sunTransmission>0).length;c.skyVisible=samples.filter(s=>s.skyTransmission>0).length;c.sampledOpenBounds=samples.length?{min:round(bounds.min.toArray()),max:round(bounds.max.toArray())}:null;
 const ranked=samples.filter(s=>s.sunTransmission>0).sort((a,b)=>new THREE.Vector3(...a.planePoint).distanceTo(center)-new THREE.Vector3(...b.planePoint).distanceTo(center));c.representative=ranked.find(s=>s.landing?.distance>80)??ranked[0]??samples[0]??null;
}
const probes=old.probes.map(p=>({name:p.name,position:p.position,sunTransmission:optics.transmission(new THREE.Ray(new THREE.Vector3(...p.position),sun)),skyUpTransmission:optics.transmission(new THREE.Ray(new THREE.Vector3(...p.position),new THREE.Vector3(0,1,0))),sunHit:blockingHit(new THREE.Ray(new THREE.Vector3(...p.position),sun))}));
const report={version:1,coordinateSystem:old.coordinateSystem,sunDirection:old.sunDirection,provenance:old.provenance,opticalGeometry:optics.stats,sourceWorldspawn:old.worldspawn,method:'Native triangles preserved. Optical BVH excludes sky/helper/decorative alpha, retains opaque base layers, samples original structural cutout PNG alpha at hit UV, and explicitly attenuates glass. Roof candidate rectangles are diagnostic sampling regions, not exact hole polygons. Use only ray-confirmed samples, never illuminate an entire candidate rectangle. No mesh or collision changes.',glassRadiometry:'Reconstructed transmission .48 clear/.32 reinforced/.18 opaque frosted; unchanged native geometry/texture. Setting createDaylightGeometry(root,{glass:false}) blocks filled panes and preserves cutout holes.',probes,candidates};
fs.writeFileSync(path.join(out,'daylight-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({stats:optics.stats,probes,candidates:candidates.map(({samples,...c})=>c)},null,2));
