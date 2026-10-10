import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {TextureDetail,textureDetailLevel} from '../export/web/texture-detail.js';
test('native texture filtering respects quality, normal-map cost, hardware and mobile limits',()=>{
 assert.equal(textureDetailLevel('balanced',16),8);assert.equal(textureDetailLevel('balanced',16,false,true),4);
 assert.equal(textureDetailLevel('quality',16),16);assert.equal(textureDetailLevel('quality',16,false,true),8);
 assert.equal(textureDetailLevel('quality',4),4);assert.equal(textureDetailLevel('performance',16),2);
 assert.equal(textureDetailLevel('quality',16,true),1);assert.equal(textureDetailLevel('quality',NaN),1);
});
test('shared texture samplers change once without changing source, mip filters or allocating replacements',()=>{
 const texture=new THREE.Texture(),normal=new THREE.Texture(),data=new THREE.DataTexture();normal.anisotropy=2;
 const material=new THREE.MeshStandardMaterial({map:texture,normalMap:normal}),root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({map:data})));
 const source=texture.source,filter=texture.minFilter,t=new TextureDetail(16);t.register(root);assert.equal(t.snapshot().textures,2);assert.equal(t.snapshot().samplerChanges,2);assert.equal(data.anisotropy,1);
 const version=texture.version;t.register(root);t.setQuality('balanced');assert.equal(texture.version,version);assert.equal(texture.source,source);assert.equal(texture.minFilter,filter);
 t.setQuality('performance');assert.equal(texture.anisotropy,2);assert.equal(normal.anisotropy,2);
 t.setQuality('quality');assert.equal(texture.anisotropy,16);assert.equal(normal.anisotropy,8);t.dispose();assert.equal(texture.anisotropy,1);assert.equal(normal.anisotropy,2);assert.equal(t.snapshot().textures,0);
});
