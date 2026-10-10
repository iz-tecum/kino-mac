// Offline-only optical geometry. Physics intentionally remains unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';

export function daylightMaterialPolicy(material){
  const name=material.extras?.sourceMaterialNames?.[0]??material.name??'';
  const base=name.startsWith('*')?name.match(/\(([^:)]+)/)?.[1]??name:name;
  if(/^wc\/(?:decal_burn_scortch|decal_burntstain_01|decal_burntstain_02|decal_darkstain_02|decal_darkstain_04|decal_darkstain_07|decal_grime_blotchy|decal_grime_drip|decal_lightstain_03|decal_wall_fillet|decal_lightstain_01)$/.test(name))return {mode:'skip',reason:'standalone decorative stain, not a physical surface',name,base};
  if(/(?:^|\/)sky(?:_|$)/.test(base)||/caulk|hdrportal|shadowcaster/.test(base))return {mode:'skip',reason:'sky or nonvisual helper',name,base};
  // A blended material is classified by its BASE surface. A decal layered on
  // opaque plaster/black backing never makes the underlying roof disappear.
  if(!material.alphaMode||material.alphaMode==='OPAQUE')return {mode:'opaque',name,base};
  if(/^wc\/(?:dec_glass01|global_glass|global_glass_reinforced|global_glass_opac)$/.test(base))return {mode:'glass',name,base,transmission:base.includes('opac')?.18:base.includes('reinforced')?.32:.48};
  if(/roofboards|catwalk|grate|chainlink|barbedfence/.test(base))return {mode:'cutout',name,base};
  return {mode:'skip',reason:'nonstructural alpha decoration',name,base};
}

// Native export alpha textures are noninterlaced 8-bit RGB/RGBA PNG. Decode
// alpha only, preserve all PNG row filters, and fail closed on unsupported data.
export function decodePngAlpha(bytes){
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Expected PNG alpha texture');
  let width,height,depth,type,interlace,paletteAlpha;const chunks=[];
  for(let at=8;at<bytes.length;){const length=bytes.readUInt32BE(at),kind=bytes.subarray(at+4,at+8).toString(),data=bytes.subarray(at+8,at+8+length);if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];type=data[9];interlace=data[12];}if(kind==='IDAT')chunks.push(data);if(kind==='tRNS')paletteAlpha=data;at+=length+12;}
  if(depth!==8||interlace!==0||![0,2,3,4,6].includes(type))throw Error(`Unsupported PNG alpha format ${depth}/${type}/${interlace}`);
  const bpp=({0:1,2:3,3:1,4:2,6:4})[type],stride=width*bpp,raw=inflateSync(Buffer.concat(chunks)),pixels=new Uint8Array(stride*height),alpha=new Uint8Array(width*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw Error('Unsupported PNG row filter');for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=bpp?pixels[i-bpp]:0,b=y?pixels[i-stride]:0,c=y&&x>=bpp?pixels[i-stride-bpp]:0;pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}
    for(let x=0;x<width;x++){const at=(y*width+x)*bpp;alpha[y*width+x]=type===6?pixels[at+3]:type===4?pixels[at+1]:type===3?(paletteAlpha?.[pixels[at]]??255):255;}}
  return {width,height,alpha};
}
export function sampleAlpha(image,u,v,sampler={}){
  const wrap=(v,mode)=>mode===33071?Math.max(0,Math.min(1-Number.EPSILON,v)):mode===33648?1-Math.abs(((v%2)+2)%2-1):((v%1)+1)%1;
  // GLTFLoader uses flipY=false; PNG's first row is v=0 in this export.
  const x=Math.min(image.width-1,Math.floor(wrap(u,sampler.wrapS)*image.width)),y=Math.min(image.height-1,Math.floor(wrap(v,sampler.wrapT)*image.height));
  return image.alpha[y*image.width+x]/255;
}

export function createDaylightGeometry(root,{glass=true,maxLayers=48,staticProps=false}={}){
  const doc=JSON.parse(fs.readFileSync(path.join(root,'kino.gltf'))),buffers=doc.buffers.map(b=>fs.readFileSync(path.join(root,b.uri))),positions=[],uvs=[],triMeta=[],policies=doc.materials.map(daylightMaterialPolicy),textures=new Map();
  const stats={triangles:0,opaqueTriangles:0,cutoutTriangles:0,glassTriangles:0,skippedTriangles:0,alphaTextures:0,unsupportedTextures:[],scope:'Native world_shell only; static prop shadows remain a separate collision/prop test.'};
  function accessor(i){const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],raw=buffers[v.buffer],C={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5121:Uint8Array}[a.componentType],components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];if(!C||!components||v.byteStride)throw Error('Unsupported native geometry accessor');return new C(raw.buffer,raw.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*components);}
  for(const [materialIndex,policy] of policies.entries()){
    if(!['glass','cutout'].includes(policy.mode))continue;const material=doc.materials[materialIndex],texture=doc.textures[material.pbrMetallicRoughness?.baseColorTexture?.index],uri=texture&&doc.images[texture.source]?.uri;if(!uri)continue;
    try{if(!textures.has(uri))textures.set(uri,decodePngAlpha(fs.readFileSync(path.join(root,decodeURIComponent(uri)))));policy.alpha=textures.get(uri);policy.sampler=doc.samplers?.[texture.sampler]??{};policy.alphaCutoff=material.alphaCutoff??.5;}catch(e){stats.unsupportedTextures.push({uri,error:String(e)});/* Missing alpha fails opaque, never creates an invented hole. */}
  }
  const entries=[{mesh:doc.meshes.find(m=>m.name==='world_shell'),matrix:null,name:'world_shell'}];
  if(staticProps){
    function visit(index,parent,hidden=false){const node=doc.nodes[index];hidden ||= !!(node.extras?.dynamicBrush||node.extras?.collisionOnly);
      const local=new THREE.Matrix4();if(node.matrix)local.fromArray(node.matrix);else local.compose(new THREE.Vector3(...(node.translation??[0,0,0])),new THREE.Quaternion(...(node.rotation??[0,0,0,1])),new THREE.Vector3(...(node.scale??[1,1,1])));
      const matrix=parent.clone().multiply(local);
      if(!hidden&&node.mesh!==undefined&&doc.meshes[node.mesh].name!=='world_shell')entries.push({mesh:doc.meshes[node.mesh],matrix,name:node.name});
      for(const child of node.children??[])visit(child,matrix,hidden);
    }
    for(const index of doc.scenes[doc.scene??0].nodes)visit(index,new THREE.Matrix4());
    stats.staticInstances=entries.length-1;stats.scope='Native world_shell and static native instances; dynamic doors, actors and movable entities excluded.';
  }
  const transformed=new THREE.Vector3();
  for(const entry of entries)for(const [primitive,p]of entry.mesh.primitives.entries()){
    const policy=policies[p.material],ix=accessor(p.indices),pos=accessor(p.attributes.POSITION),uv=p.attributes.TEXCOORD_0===undefined?null:accessor(p.attributes.TEXCOORD_0);
    if(policy.mode==='skip'){stats.skippedTriangles+=ix.length/3;continue;}
    for(let i=0;i<ix.length;i+=3){for(let j=0;j<3;j++){const at=ix[i+j];transformed.fromArray(pos,at*3);if(entry.matrix)transformed.applyMatrix4(entry.matrix);positions.push(transformed.x,transformed.y,transformed.z);uvs.push(uv?.[at*2]??0,uv?.[at*2+1]??0);}triMeta.push({materialIndex:p.material,primitive,sourceTriangle:i/3,object:entry.name});}
    stats[policy.mode+'Triangles']+=ix.length/3;
  }
  stats.triangles=triMeta.length;stats.alphaTextures=textures.size;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));const bvh=new MeshBVH(geometry,{targetLeafSize:12});geometry.boundsTree=bvh;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.name='Daylight optical world shell';const scene=new THREE.Scene();scene.add(mesh);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),weights=new THREE.Vector3(),triangle=new THREE.Triangle();
  function firstHit(ray,near=.3,far=10000){
    const hit=bvh.raycastFirst(ray,THREE.DoubleSide,near,far);if(!hit)return null;const i0=geometry.index.getX(hit.faceIndex*3),meta=triMeta[Math.floor(i0/3)],policy=policies[meta.materialIndex];hit.material=policy.name;hit.mode=policy.mode;hit.source=meta;hit.transmission=policy.mode==='glass'&&glass?policy.transmission:0;
    if(policy.alpha){const ix=[0,1,2].map(j=>geometry.index.getX(hit.faceIndex*3+j));a.fromBufferAttribute(geometry.attributes.position,ix[0]);b.fromBufferAttribute(geometry.attributes.position,ix[1]);c.fromBufferAttribute(geometry.attributes.position,ix[2]);triangle.set(a,b,c).getBarycoord(hit.point,weights);const uv=geometry.attributes.uv,u=weights.x*uv.getX(ix[0])+weights.y*uv.getX(ix[1])+weights.z*uv.getX(ix[2]),v=weights.x*uv.getY(ix[0])+weights.y*uv.getY(ix[1])+weights.z*uv.getY(ix[2]);hit.alpha=sampleAlpha(policy.alpha,u,v,policy.sampler);if(hit.alpha<policy.alphaCutoff)hit.transmission=1;}
    return hit;
  }
  function transmission(ray,near=.3,far=10000){let amount=1,previous=null;for(let layer=0;layer<maxLayers;layer++){const hit=firstHit(ray,near,far);if(!hit)return amount;if(hit.transmission===0)return 0;
    // Most native glass panes have a front/back face one unit apart. Apply the
    // artistic glazing loss once per pane, not twice for its duplicate shell.
    if(!(hit.mode==='glass'&&hit.transmission<1&&previous?.transmission<1&&previous.material===hit.material&&hit.distance-previous.distance<4))amount*=hit.transmission;
    if(amount<.01)return 0;near=hit.distance+.02;previous=hit;if(near>=far)return amount;}return 0;}
  function sampleAperture({center,normal:[nx,ny,nz],tangent,width,height,spacing=16,sourceBias=3,direction=null}){
    const n=new THREE.Vector3(nx,ny,nz).normalize(),u=new THREE.Vector3(...tangent).normalize(),v=new THREE.Vector3().crossVectors(n,u).normalize(),origin=new THREE.Vector3(...center),samples=[];
    for(let x=-width/2+spacing/2;x<width/2;x+=spacing)for(let y=-height/2+spacing/2;y<height/2;y+=spacing){const p=origin.clone().addScaledVector(u,x).addScaledVector(v,y).addScaledVector(n,-sourceBias),ray=new THREE.Ray(p,direction?new THREE.Vector3(...direction).normalize():n);const t=transmission(ray);if(t>0)samples.push({position:p.toArray(),transmission:t});}return samples;
  }
  return {scene,mesh,geometry,bvh,stats,policies,firstHit,transmission,visible:(ray,near,far)=>transmission(ray,near,far)>0,sampleAperture};
}
