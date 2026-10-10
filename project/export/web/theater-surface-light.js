import * as THREE from 'three';

// Receiver-specific direct sunlight, separate from the coarse vertex field.
// Each atlas tile is sampled against the native world and static furniture.
export const surfaceReceivers=[
  {id:'lobby',bounds:[-415,740,420,1510],height:80},
  {id:'upper-hall',bounds:[610,560,1300,1320],height:320},
  {id:'dining',bounds:[1030,-760,1750,300],height:-16},
  {id:'theater',bounds:[-700,-1650,720,-240],height:-64},
  {id:'dressing-stage',bounds:[-400,-1900,1720,-950],height:-16},
  {id:'alley',bounds:[-1910,-1200,-1210,-190],height:0},
];
export function receiverAt(position,normal){
  if(normal.y<.82)return -1;
  return surfaceReceivers.findIndex(r=>Math.abs(position.y-r.height)<3&&position.x>=r.bounds[0]&&position.x<=r.bounds[2]&&position.z>=r.bounds[1]&&position.z<=r.bounds[3]);
}

export async function loadSurfaceSunlight(){
  const response=await fetch('theater-surface-light.json');if(!response.ok)throw Error('Surface daylight data: '+response.status);
  const plan=await response.json();if(plan.version!==1||!Array.isArray(plan.regions)||plan.regions.length!==surfaceReceivers.length||plan.width!==1024||plan.height!==1536||plan.tileSize!==512)throw Error('Unsupported surface daylight');
  for(const [i,region]of plan.regions.entries()){const expected=surfaceReceivers[i];if(region.id!==expected.id||region.height!==expected.height||JSON.stringify(region.bounds)!==JSON.stringify(expected.bounds)||JSON.stringify(region.tile)!==JSON.stringify([i%2,Math.floor(i/2)]))throw Error('Surface daylight receiver mismatch');}
  const result=await fetch(plan.binary);if(!result.ok)throw Error('Surface daylight buffer: '+result.status);
  const raw=new Uint8Array(await result.arrayBuffer());if(raw.length!==plan.width*plan.height)throw Error('Surface daylight buffer length mismatch');
  const texture=new THREE.DataTexture(raw,plan.width,plan.height,THREE.RedFormat,THREE.UnsignedByteType);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  return {plan,texture};
}

export function installSurfaceSunlight(material,field,scale=4){
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    prior(shader);
    shader.uniforms.kinoSurfaceSun={value:field.texture};
    shader.vertexShader='attribute vec3 kinoSolarLight;varying vec3 kinoSolar;varying vec3 kinoSurfacePosition;varying vec3 kinoSurfaceNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nkinoSolar=kinoSolarLight;kinoSurfacePosition=(modelMatrix*vec4(transformed,1.)).xyz;kinoSurfaceNormal=normalize(mat3(modelMatrix)*normal);');
    shader.fragmentShader='uniform sampler2D kinoSurfaceSun;varying vec3 kinoSolar;varying vec3 kinoSurfacePosition;varying vec3 kinoSurfaceNormal;\n'+shader.fragmentShader;
    const p=field.plan,sun=new THREE.Vector3(...p.sunDirection);
    let code='\n#if defined(RE_IndirectDiffuse)\n';
    for(const [i,r]of p.regions.entries()){
      const [x,z,X,Z]=r.bounds;
      code+=`${i?'else ':''}if(kinoSurfaceNormal.y>.82&&abs(kinoSurfacePosition.y-(${r.height.toFixed(2)}))<3.&&kinoSurfacePosition.x>=${x.toFixed(2)}&&kinoSurfacePosition.x<=${X.toFixed(2)}&&kinoSurfacePosition.z>=${z.toFixed(2)}&&kinoSurfacePosition.z<=${Z.toFixed(2)}){\n`;
      code+=`vec2 localUV=(kinoSurfacePosition.xz-vec2(${x.toFixed(2)},${z.toFixed(2)}))/vec2(${(X-x).toFixed(2)},${(Z-z).toFixed(2)});\n`;
      code+=`vec2 atlasUV=(vec2(${r.tile[0]*p.tileSize}.5,${r.tile[1]*p.tileSize}.5)+localUV*${p.tileSize-1}.0)/vec2(${p.width}.0,${p.height}.0);\n`;
      code+=`float visibility=texture2D(kinoSurfaceSun,atlasUV).r;irradiance-=PI*${Number(scale).toFixed(3)}*kinoSolar;irradiance+=PI*visibility*${p.energy.toFixed(4)}*max(0.,dot(normalize(kinoSurfaceNormal),vec3(${sun.x.toFixed(6)},${sun.y.toFixed(6)},${sun.z.toFixed(6)})))*vec3(${p.color.map(v=>v.toFixed(5)).join(',')});}\n`;
    }
    code+='#endif\n';
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>','#include <lights_fragment_maps>'+code);
  };
  material.customProgramCacheKey=()=>priorKey+'-surface-sun-v1-'+scale;material.needsUpdate=true;
}
