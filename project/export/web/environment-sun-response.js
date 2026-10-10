import * as THREE from 'three';

// The atlas is the existing reconstructed static visibility field, not a new
// light or a new shadow pass. Its geometric receiver test stays untouched.
const atlasContribution=/irradiance\+=PI\*visibility\*[^;]+;/g;
export const sunSpecularStrength=quality=>quality==='performance'?0:quality==='quality'?.6:.4;
// The exact native names explicitly identify glazed/varnished surfaces. These
// restrained coefficients are reconstructed, not extracted T5 specular values.
export const authoredGlossRoughness=Object.freeze({'wc/pent_art_floor_tile06_glossy':.58,'wc/pent_art_wall_wood01_glossy':.64});
const authoredStoneRoughness=Object.freeze({'wc/mtl_theater_gold_tile_base':.68,'wc/mtl_theater_gold_tile_trim':.68});
function authoredRoughness(material){const name=material?.name||'',base=name.startsWith('*')?name.match(/\(([^:)]+)/)?.[1]:name;return authoredGlossRoughness[name]??authoredStoneRoughness[base];}

export function composeSunResponse(shader,uniforms,expectedReceivers){
  let replaced=0;
  shader.fragmentShader=shader.fragmentShader.replace(atlasContribution,()=>{
    replaced++;
    return `
      vec3 kinoSunLightDir=normalize(mat3(viewMatrix)*kinoSunWorldDirection);
      float kinoSunFacing=max(0.,dot(normal,kinoSunLightDir));
      vec3 kinoSunIrradiance=PI*visibility*kinoSunEnergy*kinoSunColor*kinoSunFacing;
      irradiance+=kinoSunIrradiance;
      if(kinoSunSpecular>0. && visibility>.0001 && kinoSunFacing>.0001){
        reflectedLight.directSpecular+=kinoSunIrradiance*kinoSunSpecular*
          BRDF_GGX(kinoSunLightDir,geometryViewDir,normal,material);
      }
    `;
  });
  if(replaced!==expectedReceivers)throw Error(`Surface sunlight response composition mismatch: ${replaced}/${expectedReceivers}`);
  shader.fragmentShader='uniform vec3 kinoSunWorldDirection;uniform vec3 kinoSunColor;uniform float kinoSunEnergy;uniform float kinoSunSpecular;\n'+shader.fragmentShader;
  Object.assign(shader.uniforms,uniforms);
  return replaced;
}

function visible(mesh){for(let p=mesh;p;p=p.parent)if(!p.visible||p.userData?.collisionOnly)return false;return true;}

/** Restore the missing fine normal / roughness response of atlas-lit opaque
 * native map surfaces. No material, texture, UV, vertex, or batching changes.
 * Call after the original irradiance + surface-atlas hooks are installed.
 */
export class EnvironmentSunResponse {
  constructor(root,field){
    if(!field?.plan?.regions?.length)throw Error('Surface sunlight response requires the existing atlas');
    this.uniforms={kinoSunWorldDirection:{value:new THREE.Vector3(...field.plan.sunDirection).normalize()},kinoSunColor:{value:new THREE.Color(...field.plan.color)},kinoSunEnergy:{value:field.plan.energy},kinoSunSpecular:{value:sunSpecularStrength('balanced')}};
    this.records=new Map();this.quality='balanced';this.disposed=false;this.authoredGlossMaterials=0;this.authoredStoneMaterials=0;
    const expected=field.plan.regions.length;
    root.traverse(mesh=>{
      if(!mesh.isMesh||mesh.isSkinnedMesh||!mesh.geometry?.attributes.kinoSolarLight||!visible(mesh))return;
      for(const material of [mesh.material].flat()){
        const gloss=authoredRoughness(material);
        if(!material?.isMeshStandardMaterial||material.transparent||(!material.normalMap&&gloss===undefined)||!material.userData.kinoIrradiance||this.records.has(material))continue;
        const prior=material.onBeforeCompile,key=material.customProgramCacheKey,roughness=material.roughness;
        this.records.set(material,{prior,key,roughness});
        if(gloss!==undefined){material.roughness=gloss;if(authoredGlossRoughness[material.name]!==undefined)this.authoredGlossMaterials++;else this.authoredStoneMaterials++;}
        const uniforms=this.uniforms;
        material.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);composeSunResponse(shader,uniforms,expected);};
        material.customProgramCacheKey=function(){return key.call(this)+'-native-sun-response-v1';};
        material.needsUpdate=true;
      }
    });
  }
  update({quality='balanced'}={}){if(this.disposed)return;this.quality=quality;this.uniforms.kinoSunSpecular.value=sunSpecularStrength(quality);}
  reset(){/* Static optical data has no simulation clock or session state. */}
  snapshot(){return {materials:this.records.size,authoredGlossMaterials:this.authoredGlossMaterials,authoredStoneMaterials:this.authoredStoneMaterials,quality:this.quality,specularStrength:this.uniforms.kinoSunSpecular.value,additionalDrawCalls:0,additionalTextures:0,additionalRays:0,disposed:this.disposed};}
  dispose(){if(this.disposed)return;for(const [material,{prior,key,roughness}]of this.records){material.onBeforeCompile=prior;material.customProgramCacheKey=key;material.roughness=roughness;material.needsUpdate=true;}this.records.clear();this.authoredGlossMaterials=this.authoredStoneMaterials=0;this.disposed=true;}
}
