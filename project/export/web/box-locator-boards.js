import * as THREE from 'three';

// Native kino.gltf world_shell / wc/mtl_theater_chalkmap: nine disjoint panels.
// Frames are world = origin + u * UV.x + v * UV.y, fitted from the largest
// native UV triangle in each panel. Marker IDs are NOT consecutive by board:
// IDs2516–2519 append lamps on earlier boards. Raw marker positions are correct.
export const BOX_LOCATOR_BOARDS=Object.freeze([{"location":"alleyway_chest","firstVertex":0,"origin":[-1549.024414,123.0,-177.0],"u":[-0.0,-0.0,-94.0],"v":[-0.0,-68.000008,-0.0],"normal":[1.0,0.0,0.0],"triangles":19},{"location":"crematorium_chest","firstVertex":267,"origin":[-1338.024414,193.0,689.0],"u":[-0.0,-0.0,-106.0],"v":[-0.0,-68.0,-0.0],"normal":[1.0,0.0,-0.0],"triangles":4},{"location":"theater_chest","firstVertex":81,"origin":[99.108395,80.186508,-80.521448],"u":[-0.0,-0.0,102.999939],"v":[-13.672845,-66.61032,-0.0],"normal":[-0.979576,0.201074,0.0],"triangles":30},{"location":"foyer_chest","firstVertex":207,"origin":[-50.250718,371.016585,626.0],"u":[105.000718,0.0,0.0],"v":[-0.0,-68.016585,-0.0],"normal":[0.0,0.0,1.0],"triangles":18},{"location":"start_chest","firstVertex":171,"origin":[957.75,457.0,576.750047],"u":[-0.0,-0.0,98.0],"v":[-0.0,-68.0,-0.0],"normal":[-1.0,0.0,0.0],"triangles":12},{"location":"dining_chest","firstVertex":63,"origin":[1611.0,109.0,-766.0],"u":[101.0,-0.0,-0.0],"v":[-0.0,-68.0,-0.0],"normal":[0.0,0.0,1.0],"triangles":2},{"location":"dressing_chest","firstVertex":69,"origin":[1284.0,74.000004,-1267.5],"u":[-0.0,-0.0,-100.0],"v":[-0.0,-68.000004,-0.0],"normal":[1.0,0.0,-0.0],"triangles":4},{"location":"stage_chest","firstVertex":57,"origin":[-50.0,103.0,-1894.0],"u":[101.0,0.0,0.0],"v":[-0.0,-68.0,-0.0],"normal":[0.0,0.0,1.0],"triangles":2},{"location":"control_chest","firstVertex":261,"origin":[-1330.0,267.0,-1054.5],"u":[-0.0,-0.0,102.0],"v":[-0.0,-67.0,-0.0],"normal":[-1.0,0.0,0.0],"triangles":2}]);

export function boxLocatorBoard(entity){
  for(const board of BOX_LOCATOR_BOARDS){
    const d=new THREE.Vector3(...entity.position).sub(new THREE.Vector3(...board.origin)),uAxis=new THREE.Vector3(...board.u),vAxis=new THREE.Vector3(...board.v);
    const u=d.dot(uAxis)/uAxis.lengthSq(),v=d.dot(vAxis)/vAxis.lengthSq(),distance=Math.abs(d.dot(new THREE.Vector3(...board.normal)));
    if(u>=0&&u<=1&&v>=0&&v<=1&&distance<1)return {board,u,v,distance};
  }
  return null;
}

// Clip the missing native compound layer to its existing backing triangles.
// This does not invent a rectangular board across gaps or change world geometry.
export function restoreBoxLocatorDecals(scene){
  const name='box_locator_native_chalk_lobby',existing=scene.getObjectByName(name);
  if(existing)return existing.userData.restoration;
  const board=BOX_LOCATOR_BOARDS.find(b=>b.location==='foyer_chest'),origin=new THREE.Vector3(...board.origin),uAxis=new THREE.Vector3(...board.u),vAxis=new THREE.Vector3(...board.v),normal=new THREE.Vector3(...board.normal);
  let chalk;const sources=[];
  scene.updateMatrixWorld(true);
  scene.traverse(object=>{
    if(!object.isMesh||object.isInstancedMesh)return;
    const materials=[object.material].flat();
    for(const material of materials){
      if(material?.name==='wc/mtl_theater_chalkmap')chalk=material;
    }
    if(materials.some(m=>(m?.userData?.sourceMaterialNames??[]).some(n=>n.includes(':wc/mtl_theater_chalkmap'))))sources.push(object);
  });
  const positions=[],uvs=[],seen=new Set();
  function clip(poly,axis,bound,sign){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=(a.uv[axis]-bound)*sign,db=(b.uv[axis]-bound)*sign;
      if(da>=0)out.push(a);
      if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({p:a.p.clone().lerp(b.p,t),uv:a.uv.map((v,j)=>v+(b.uv[j]-v)*t)});}
    }
    return out;
  }
  for(const object of sources){
    const g=object.geometry,pos=g.attributes.position,index=g.index,groups=g.groups.length?g.groups:[{start:0,count:index?.count??pos.count,materialIndex:0}];
    for(const group of groups){
      const m=Array.isArray(object.material)?object.material[group.materialIndex]:object.material;
      if(!(m?.userData?.sourceMaterialNames??[]).some(n=>n.includes(':wc/mtl_theater_chalkmap')))continue;
      for(let i=group.start;i<group.start+group.count;i+=3){
        let poly=[0,1,2].map(k=>{const p=new THREE.Vector3().fromBufferAttribute(pos,index?index.getX(i+k):i+k).applyMatrix4(object.matrixWorld),d=p.clone().sub(origin);return {p,uv:[d.dot(uAxis)/uAxis.lengthSq(),d.dot(vAxis)/vAxis.lengthSq()],plane:d.dot(normal)};});
        if(poly.some(v=>Math.abs(v.plane)>.05))continue;
        const key=poly.map(v=>v.p.toArray().map(n=>n.toFixed(4)).join(',')).sort().join(';');if(seen.has(key))continue;seen.add(key);
        for(const [axis,bound,sign]of [[0,0,1],[0,1,-1],[1,0,1],[1,1,-1]])poly=clip(poly,axis,bound,sign);
        for(let k=1;k<poly.length-1;k++)for(const v of [poly[0],poly[k],poly[k+1]]){positions.push(...v.p.toArray());uvs.push(...v.uv.map(n=>Math.max(0,Math.min(1,n))));}
      }
    }
  }
  const result={materials:chalk?1:0,geometryAdded:0,textureAdded:0,depthTest:true,triangles:positions.length/9,reason:'Native compound wood/metal + chalkmap layer was flattened by the exporter; native UV projection restored on original backing triangles'};
  if(!chalk?.map||!positions.length)return result;
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  const material=new THREE.MeshBasicMaterial({map:chalk.map,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
  const overlay=new THREE.Mesh(geometry,material);overlay.name=name;overlay.renderOrder=1;result.geometryAdded=1;overlay.userData.restoration=result;scene.add(overlay);return result;
}

// Only the recovered layer is owned here. The native chalk map and backing
// remain shared with the loaded world and must outlive locator disposal.
export function disposeBoxLocatorDecals(scene){
  const overlay=scene.getObjectByName('box_locator_native_chalk_lobby');
  if(!overlay?.userData.restoration)return;
  overlay.removeFromParent();overlay.geometry.dispose();overlay.material.dispose();
}
