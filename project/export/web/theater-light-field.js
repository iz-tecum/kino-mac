import * as THREE from 'three';
import { installSurfaceSunlight } from './theater-surface-light.js';
import { geometryFingerprint } from './environment-occlusion.js';

// Newly reconstructed irradiance, not extracted T5 lightmaps. The bake uses
// the original geometry for both visibility and native fixture placement.
export function lightFalloff(source, position, normal) {
  const delta = new THREE.Vector3().fromArray(source.position).sub(position);
  const distance = delta.length();
  if (distance >= source.radius || distance < .1) return 0;
  delta.divideScalar(distance);
  const facing = Math.max(0, normal.dot(delta));
  if (!facing) return 0;
  let cone = 1;
  if (source.direction) {
    const cosine = -delta.dot(new THREE.Vector3().fromArray(source.direction));
    const outer = Math.cos(source.angle * Math.PI / 180);
    const inner = Math.cos(source.angle * .64 * Math.PI / 180);
    cone = THREE.MathUtils.smoothstep(cosine, outer, inner);
  }
  return facing * cone * source.energy * (1 - distance / source.radius) ** 1.35 /
    (1 + (distance / source.falloff) ** 2);
}

export function installIrradianceMaterial(material, power, scale = 4) {
  const shade = material.clone();
  shade.userData = { ...material.userData, kinoIrradiance: true };
  shade.onBeforeCompile = shader => {
    shader.uniforms.kinoPower = power;
    shader.vertexShader = 'attribute vec3 kinoBaseLight; attribute vec3 kinoPowerLight; varying vec3 vKinoBaseLight; varying vec3 vKinoPowerLight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvKinoBaseLight = kinoBaseLight; vKinoPowerLight = kinoPowerLight;');
    shader.fragmentShader = 'uniform float kinoPower; varying vec3 vKinoBaseLight; varying vec3 vKinoPowerLight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>\n#if defined(RE_IndirectDiffuse)\nirradiance += ${Number(scale).toFixed(3)} * PI * (vKinoBaseLight + kinoPower * vKinoPowerLight);\n#endif`);
  };
  shade.customProgramCacheKey = () => `kino-irradiance-v1-${scale}`;
  return shade;
}

export async function prepareTheaterLightField(root, {
  manifest, binary, surfaceSunlight, manifestUrl = 'theater-irradiance.json',
} = {}) {
  manifest ??= await fetch(manifestUrl).then(r => { if (!r.ok) throw new Error('Theater light data: '+r.status); return r.json(); });
  if (manifest.version !== 1) throw new Error('Unsupported theater light field');
  binary ??= await fetch(manifest.binary).then(r => { if (!r.ok) throw new Error('Theater light buffer: '+r.status); return r.arrayBuffer(); });
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  if (!Number.isSafeInteger(manifest.byteLength) || bytes.length !== manifest.byteLength) throw new Error('Theater light buffer length mismatch');
  let solar=null;if(manifest.solarBinary){const r=await fetch(manifest.solarBinary);if(!r.ok)throw Error('Solar light buffer: '+r.status);solar=new Uint8Array(await r.arrayBuffer());if(solar.length!==manifest.solarByteLength||solar.length*2!==bytes.length)throw Error('Solar light buffer length mismatch');}
  const stats = { meshes:0, vertices:0, bytes:0, shaderMaterials:0 };
  const power = { value:0 };
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.userData.environmentOcclusion) return;
    const geometry = mesh.geometry, key = geometryFingerprint(geometry.attributes.position,geometry.attributes.normal), entry = manifest.geometry[key];
    if (!entry) return;
    if (!Number.isSafeInteger(entry.count) || !Number.isSafeInteger(entry.offset) || entry.count !== geometry.attributes.position.count || entry.offset < 0 || entry.offset % 6 !== 0 || entry.offset + entry.count*6 > bytes.length) throw new Error('Theater light geometry mismatch');
    const base = new Uint8Array(entry.count*3), lit = new Uint8Array(entry.count*3);
    for (let i=0;i<entry.count;i++) for (let c=0;c<3;c++) {
      base[i*3+c]=bytes[entry.offset+i*6+c]; lit[i*3+c]=bytes[entry.offset+i*6+3+c];
    }
    geometry.setAttribute('kinoBaseLight',new THREE.BufferAttribute(base,3,true));
    geometry.setAttribute('kinoPowerLight',new THREE.BufferAttribute(lit,3,true));
    if(solar)geometry.setAttribute('kinoSolarLight',new THREE.BufferAttribute(solar.slice(entry.offset/2,entry.offset/2+entry.count*3),3,true));
    stats.meshes++;stats.vertices+=entry.count;stats.bytes+=base.byteLength+lit.byteLength+(solar?entry.count*3:0);
  });
  return { manifest, power, stats,
    // Compile only AFTER batching, so custom material hooks never defeat the
    // existing static optimizer. Never alter shared unbaked door/prop materials.
    install(root) {
      const variants=new Map();
      root.traverse(mesh=>{
        if(!mesh.isMesh||!mesh.geometry.attributes.kinoBaseLight)return;
        const apply=m=>{if(!variants.has(m)){const shade=installIrradianceMaterial(m,power,manifest.scale);if(surfaceSunlight&&solar)installSurfaceSunlight(shade,surfaceSunlight,manifest.scale);variants.set(m,shade);}return variants.get(m);};
        mesh.material=Array.isArray(mesh.material)?mesh.material.map(apply):apply(mesh.material);
      });
      stats.shaderMaterials=variants.size;
    },
    reset(){power.value=0;},
  };
}
