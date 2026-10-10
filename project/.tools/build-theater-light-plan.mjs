import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
const root=path.resolve(import.meta.dirname,'../export/web');
const data=JSON.parse(fs.readFileSync(path.join(root,'game-data.json')));
const gltf=JSON.parse(fs.readFileSync(path.join(root,'kino.gltf')));
const sources=[];
for(const e of data.entities.filter(e=>e.classname==='light')){
  const event=e.script_mixer_event||'';
  // Event-specific teleporter, projector and fire-trap pulses are handled by
  // their gameplay systems, not baked as permanently powered room lamps.
  if(['pl1','sip','ft1'].includes(event))continue;
  const color=(e.script_light2_color||e._color||'1 .8 .6').trim().split(/\s+/).map(Number);
  if(color.every(n=>n===0))continue;
  const ceiling=/^tl/.test(event), powered=ceiling||event==='ZPO'||e.targetname==='light_off';
  const lobbyWorkLight=String(e.id)==='2739';
  const renderedColor=lobbyWorkLight?color.map(c=>c*.5+.32):color;
  sources.push({id:'entity-'+e.id,position:e.position,color:renderedColor,sourceColor:color,powered,
    radius:Number(e.radius)*(ceiling?2.2:1.65),falloff:ceiling?450:180,
    energy:ceiling?2.3:lobbyWorkLight?1.05:1.4,direction:ceiling?[0,-1,0]:null,angle:ceiling?57:180,
    provenance:'Original light entity '+e.id+' position; missing target means aiming/radiometry reconstructed.'+(lobbyWorkLight?' Cold work-light saturation reduced for retail reference; raw color preserved in sourceColor.':' Original color preserved.')});
}
const matrix=new THREE.Matrix4(),point=new THREE.Vector3(),direction=new THREE.Vector3();
let counter=0;
for(const node of gltf.nodes){
  const name=node.name||'';
  if(!node.matrix)continue;
  const work=name==='i_p_glo_stage_light_on',sconce=/^i_lights_sconce_(on|off)$/.test(name);
  if(!work&&!sconce)continue;
  matrix.fromArray(node.matrix);
  point.set(0,work?-3:12,work?14:16).applyMatrix4(matrix);
  direction.set(0,0,1).transformDirection(matrix);
  sources.push({id:'fixture-'+counter++,fixture:name,position:point.toArray(),direction:work?direction.toArray():null,
    color:work?[.56,.72,.85]:[1,.66,.32],powered:sconce&&!name.endsWith('_on'),
    radius:work?650:290,falloff:work?220:140,energy:work?3.1:1.65,angle:work?52:180,
    glowRadius:work?4.5:2.4,shaft:work,
    glowPositions:sconce?[-7,7].map(x=>new THREE.Vector3(x,12,15).applyMatrix4(matrix).toArray()):undefined,
    provenance:'Existing '+name+' matrix; lens position and lamp radiometry reconstructed.'});
}
// Existing bulbs in the wardrobe/vanity have aged tungsten warmth. Only a few
// low-output sources are needed; the original prop geometry remains untouched.
for(const e of data.entities.filter(e=>e.model==='lights_hang_single')){
  if(sources.some(s=>new THREE.Vector3(...s.position).distanceTo(new THREE.Vector3(...e.position))<70))continue;
  sources.push({id:'pendant-'+e.id,position:[e.position[0],e.position[1]-8,e.position[2]],color:[1,.67,.36],powered:true,
    radius:320,falloff:180,energy:1.65,direction:null,angle:180,glowRadius:2,
    provenance:'Original suspended lamp entity '+e.id+'; warm incandescent approximation.'});
}
// Intact wall-mounted vanity bulbs: retain the broken/fallen components. A
// sparse surviving circuit keeps the room's wartime wear and avoids a modern
// uniformly glowing mirror. Bulb locations are native; energized selection is
// an explicitly reconstructed lighting treatment.
let vanity=0;
for(const node of gltf.nodes.filter(n=>n.name==='i_zombie_theater_dresslight1'&&n.matrix)){
  matrix.fromArray(node.matrix);point.set(0,0,5.2).applyMatrix4(matrix);
  direction.set(0,0,1).transformDirection(matrix);
  if(point.y<28||Math.abs(direction.y)>.35||vanity++%3!==0)continue;
  sources.push({id:'vanity-'+vanity,fixture:node.name,position:point.toArray(),color:[1,.70,.40],powered:true,
    radius:130,falloff:65,energy:.24,direction:null,angle:180,glowRadius:2.2,noAccent:true,
    provenance:'Intact native vanity bulb; sparse warm powered circuit reconstructed.'});
}
// A modest first-bounce approximation at optically verified sunlight receivers.
// These are explicit new indirect sources, not claimed native light entities.
const daylightPath=path.join(root,'theater-daylight.json');
if(fs.existsSync(daylightPath))for(const shaft of JSON.parse(fs.readFileSync(daylightPath)).shafts){
  if(shaft.room==='Alley')continue;
  const toward=new THREE.Vector3(...shaft.start).sub(new THREE.Vector3(...shaft.end)).normalize();
  const position=new THREE.Vector3(...shaft.end).addScaledVector(toward,18).toArray();
  sources.push({id:'bounce-'+shaft.id,position,color:[.84,.81,.72],powered:false,
    radius:310,falloff:160,energy:.42*shaft.transmission,direction:null,angle:180,noAccent:true,
    provenance:'Reconstructed indirect sun reflection near verified '+shaft.room+' receiver; optical visibility prevents cross-wall spill.'});
}
const world=data.entities.find(e=>e.classname==='worldspawn');
const [pitch,yaw]=world.sundirection.split(' ').map(n=>Number(n)*Math.PI/180);
// CoD forward maps from (x,y,z) to Three (x,z,-y); negative pitch points up.
const sunDirection=[Math.cos(pitch)*Math.cos(yaw),-Math.sin(pitch),-Math.cos(pitch)*Math.sin(yaw)];
const plan={version:1,description:'Original Kino fixture positions/colors with reconstructed missing aim, occluded static illumination and restrained period practicals.',
  worldspawn:world,sun:{direction:sunDirection,color:[.91,.86,.73],energy:1.35},sky:{color:[.54,.67,.83],energy:.72,samples:9},sources,
  replacements:['New radiometry and light/shadow bake; original T5 lightmaps unavailable.','Spotlight target entities absent; ceiling spots aim down by deliberate approximation.','Original period fixtures and set dressing retained; missing fixture 2715 restored from supplied geometry.']};
fs.writeFileSync(path.join(root,'theater-light-plan.json'),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({sources:sources.length,always:sources.filter(s=>!s.powered).length,powered:sources.filter(s=>s.powered).length,sunDirection}));
