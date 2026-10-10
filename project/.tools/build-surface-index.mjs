import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { SurfaceIndex, SURFACE_CLASSES, baseMaterialName, classifySurface } from '../export/web/surface-index.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Replay bake-world.mjs without writing collision or navigation. Every accepted
// transformed vertex is byte-compared in order against the shipped collision.
// If the bake/filter/crop ever diverges, generation fails instead of guessing.
export function buildSurfaceIndex({doc,buffer,data,metadata,collision,sourceHashes={}}){
  const descriptor=metadata.layout.position;
  if(descriptor.type!=='Float32Array'||metadata.layout.index.type!=='Uint32Array')throw new Error('Unsupported collision layout');
  const expected=collision.subarray(descriptor.byteOffset,descriptor.byteOffset+descriptor.byteLength);
  const chunk=new Float32Array(16384*3),positionHash=createHash('sha256');let chunkCount=0,verifiedBytes=0;
  function flush(){
    const bytes=Buffer.from(chunk.buffer,0,chunkCount*4);
    if(!bytes.equals(expected.subarray(verifiedBytes,verifiedBytes+bytes.length)))throw new Error('Collision vertex order/content differs at byte '+verifiedBytes+'; rebuild collision before surface index');
    positionHash.update(bytes);verifiedBytes+=bytes.length;chunkCount=0;
  }
  function acc(i){
    const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array},size={VEC3:3,VEC2:2,SCALAR:1}[a.type],Type=types[a.componentType];
    if(!Type||!size||a.sparse||v.byteStride&&v.byteStride!==size*Type.BYTES_PER_ELEMENT)throw new Error('Unsupported accessor '+i);
    return new Type(buffer.buffer,buffer.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*size);
  }
  const p=new THREE.Vector3(),matrix=new THREE.Matrix4(),triangleBounds=new THREE.Box3();
  const bonusRooms=data.entities.filter(e=>/^ee_teleport_player[0-3]$/.test(e.targetname)).map(room=>{
    const center=new THREE.Vector3(...room.position),box=new THREE.Box3(center.clone(),center.clone());
    for(const reel of data.entities.filter(e=>e.targetname?.startsWith('trigger_movie_reel_'))){const point=new THREE.Vector3(...reel.position);if(point.distanceTo(center)<550)box.expandByPoint(point);}
    box.min.add(new THREE.Vector3(-160,-100,-160));box.max.add(new THREE.Vector3(160,250,160));return box;
  });
  const ranges=[],materials=new Map();let vertices=0,triangles=0,rejected=0;
  for(const node of doc.nodes){
    if(node.mesh===undefined||node.extras?.dynamicBrush)continue;
    matrix.identity();if(node.matrix)matrix.fromArray(node.matrix);else if(node.translation)matrix.makeTranslation(...node.translation);
    for(const prim of doc.meshes[node.mesh].primitives){
      const name=doc.materials[prim.material]?.name||'',base=baseMaterialName(name);
      if(/sky|decal|glass|foliage|ivy|wire|cable|distant|lightshaft|water|blood|paper|zombie_eye/i.test(base))continue;
      const src=acc(prim.attributes.POSITION),ix=acc(prim.indices),verts=new Float32Array(src.length);
      for(let i=0;i<src.length;i+=3){p.fromArray(src,i).applyMatrix4(matrix);p.toArray(verts,i);}
      const used=new Set(),start=vertices;let acceptedTriangles=0;
      for(let i=0;i<ix.length;i+=3){
        const tri=[ix[i],ix[i+1],ix[i+2]];
        if(tri.some(v=>verts[v*3]<-2250||verts[v*3]>2200||verts[v*3+1]<-100||verts[v*3+1]>520||verts[v*3+2]<-2150||verts[v*3+2]>2150)){
          triangleBounds.makeEmpty();for(const v of tri)triangleBounds.expandByPoint(p.fromArray(verts,v*3));
          if(!bonusRooms.some(box=>box.intersectsBox(triangleBounds))){rejected++;continue;}
        }
        for(const v of tri)if(!used.has(v)){
          used.add(v);chunk[chunkCount++]=verts[v*3];chunk[chunkCount++]=verts[v*3+1];chunk[chunkCount++]=verts[v*3+2];vertices++;
          if(chunkCount===chunk.length)flush();
        }
        triangles++;acceptedTriangles++;
      }
      if(vertices===start)continue;
      const surface=classifySurface(name),id=SURFACE_CLASSES.indexOf(surface),last=ranges.at(-1);
      if(last?.[1]===id)last[0]=vertices;else ranges.push([vertices,id]);
      const material=materials.get(name)??{name,base,surface,vertices:0,triangles:0};
      material.vertices+=vertices-start;material.triangles+=acceptedTriangles;materials.set(name,material);
    }
  }
  flush();
  if(verifiedBytes!==expected.length||vertices!==metadata.vertices||triangles!==metadata.triangles)throw new Error('Collision vertex/triangle totals differ; rebuild collision before surface index');
  const result={format:'kino-surface-index-v1',source:'kino.gltf native structural material names; bake-world.mjs static collision order',classes:SURFACE_CLASSES,vertices,triangles,ranges,verification:{...sourceHashes,collisionSha256:hash(collision),positionSha256:positionHash.digest('hex'),verifiedPositionBytes:verifiedBytes,rejectedTriangles:rejected}};
  const lookup=new SurfaceIndex(result),indexDescriptor=metadata.layout.index;
  const indices=new Uint32Array(collision.buffer,collision.byteOffset+indexDescriptor.byteOffset,indexDescriptor.count);
  // Reordered BVH faces must still use only one source surface class each.
  for(let i=0;i<indices.length;i+=3){
    const surface=lookup.surfaceForVertex(indices[i]);
    if(indices[i]>=vertices||indices[i+1]>=vertices||indices[i+2]>=vertices||surface!==lookup.surfaceForVertex(indices[i+1])||surface!==lookup.surfaceForVertex(indices[i+2]))throw new Error('Collision face crosses source surface ranges: '+i/3);
  }
  return {index:result,report:{...result.verification,vertices,triangles,ranges:ranges.length,materials:[...materials.values()]}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'export/web');
  const source=fs.readFileSync(path.join(out,'kino.gltf')),buffer=fs.readFileSync(path.join(out,'kino.bin')),gameData=fs.readFileSync(path.join(out,'game-data.json'));
  const {index,report}=buildSurfaceIndex({doc:JSON.parse(source),buffer,data:JSON.parse(gameData),metadata:JSON.parse(fs.readFileSync(path.join(out,'collision.json'))),collision:fs.readFileSync(path.join(out,'collision.bin')),sourceHashes:{gltfSha256:hash(source),meshSha256:hash(buffer),gameDataSha256:hash(gameData),bakeSourceSha256:hash(fs.readFileSync(path.join(root,'.tools/bake-world.mjs')))}});
  const output=JSON.stringify(index)+'\n',destination=path.join(out,'surface-index.json');
  if(process.argv.includes('--check')){if(fs.readFileSync(destination,'utf8')!==output)throw new Error('Generated surface index is stale');}
  else fs.writeFileSync(destination,output);
  const artifacts=path.join(root,'artifacts','surface-index');fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({verified:true,vertices:index.vertices,triangles:index.triangles,ranges:index.ranges.length,bytes:Buffer.byteLength(output),positionSha256:index.verification.positionSha256,collisionSha256:index.verification.collisionSha256}));
}
