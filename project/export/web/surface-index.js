import { surfaceFromMaterial } from './audio-surfaces.js';

export const SURFACE_CLASSES=Object.freeze(['concrete','carpet','wood','metal','dirt']);

// T5 compound materials list the structural base before decorative layers.
// A blood, grime or splinter overlay must not change the supporting floor.
export function baseMaterialName(name=''){
  return name.startsWith('*')?(name.match(/\(([^:)]+)/)?.[1]??name):name.replace(/^[^:]+:(?=[mw]c\/)/,'');
}
export function classifySurface(name){
  const base=baseMaterialName(name).toLowerCase();
  if(/cloth_runner|velvet/.test(base))return 'carpet';
  if(/catwalk|gantry/.test(base))return 'metal';
  return surfaceFromMaterial(base);
}

// BVH construction reorders faces, not vertices. The generated index stores
// exclusive vertex ends and a surface class for each contiguous range.
export class SurfaceIndex {
  constructor(data){
    if(data?.format!=='kino-surface-index-v1'||!Number.isInteger(data.vertices)||data.vertices<=0||!Number.isInteger(data.triangles)||data.triangles<=0||!Array.isArray(data.ranges)||data.classes?.join(',')!==SURFACE_CLASSES.join(','))throw new TypeError('Invalid surface index');
    let end=0;
    for(const range of data.ranges){
      if(!Array.isArray(range)||range.length!==2||!Number.isInteger(range[0])||range[0]<=end||range[0]>data.vertices||!Number.isInteger(range[1])||!SURFACE_CLASSES[range[1]])throw new TypeError('Invalid surface range');
      end=range[0];
    }
    if(end!==data.vertices)throw new TypeError('Incomplete surface index');
    this.vertices=data.vertices;this.triangles=data.triangles;
    this.ends=Uint32Array.from(data.ranges,r=>r[0]);this.classes=Uint8Array.from(data.ranges,r=>r[1]);
  }
  surfaceForVertex(vertex){
    if(!Number.isInteger(vertex)||vertex<0||vertex>=this.vertices)return 'concrete';
    let lo=0,hi=this.ends.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(vertex<this.ends[mid])hi=mid;else lo=mid+1;}
    return SURFACE_CLASSES[this.classes[lo]];
  }
  surfaceForHit(collision,hit){
    const geometry=collision?.geometry,index=geometry?.index,face=hit?.faceIndex;
    if(geometry?.attributes?.position?.count!==this.vertices||index?.count!==this.triangles*3||!Number.isInteger(face)||face<0||face>=this.triangles)return 'concrete';
    return this.surfaceForVertex(index.getX(face*3));
  }
}

export async function loadSurfaceIndex(url='surface-index.json'){
  const response=await fetch(url);if(!response.ok)throw new Error('Surface index HTTP '+response.status);
  return new SurfaceIndex(await response.json());
}
