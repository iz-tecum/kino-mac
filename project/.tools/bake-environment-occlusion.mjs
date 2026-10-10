import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { deserializeCollisionWorld } from '../export/web/collision-world.js';
import { geometryFingerprint } from '../export/web/environment-occlusion.js';

const root = path.resolve(import.meta.dirname, '../export/web');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'kino.gltf')));
const buffer = fs.readFileSync(path.join(root, 'kino.bin'));
const collisionBytes = fs.readFileSync(path.join(root, 'collision.bin'));
const collision = deserializeCollisionWorld(JSON.parse(fs.readFileSync(path.join(root, 'collision.json'))),
  collisionBytes.buffer.slice(collisionBytes.byteOffset, collisionBytes.byteOffset + collisionBytes.byteLength));
const rayCount = 16, reach = 160, floor = .52, strength = .68, bias = 2.5;
const position = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
const direction = new THREE.Vector3(), ray = new THREE.Ray(), cache = new Map(), geometry = {}, chunks = [];
const samples = Array.from({ length: rayCount }, (_, i) => {
  const r = Math.sqrt((i + .5) / rayCount), angle = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, Math.sqrt(1 - r * r));
});
function attribute(index) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  if (a.componentType !== 5126 || view.byteStride) throw new Error('Expected tightly packed float geometry');
  const array = new Float32Array(buffer.buffer, buffer.byteOffset + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * 3);
  return new THREE.BufferAttribute(array, 3);
}
let offset = 0, total = 0, minimum = 255, maximum = 0, sum = 0, rays = 0;
const started = performance.now();
for (const primitive of doc.meshes.find(mesh => mesh.name === 'world_shell').primitives) {
  const material = doc.materials[primitive.material];
  const name = material.extras?.sourceMaterialNames?.[0] || material.name;
  const base = name.startsWith('*') ? name.match(/\(([^:)]+)/)?.[1] || name : name;
  if (material.alphaMode || /sky|decal|glass|foliage|ivy|wire|cable|distant|lightshaft|water|blood|paper|eye|caulk|shadowcaster|hdrportal/.test(base)) continue;
  const points = attribute(primitive.attributes.POSITION), normals = attribute(primitive.attributes.NORMAL);
  const fingerprint = geometryFingerprint(points, normals);
  if (geometry[fingerprint]) continue;
  const ao = new Uint8Array(points.count);
  for (let i = 0; i < points.count; i++) {
    position.fromBufferAttribute(points, i); normal.fromBufferAttribute(normals, i).normalize();
    const key = `${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}:${normal.x.toFixed(3)},${normal.y.toFixed(3)},${normal.z.toFixed(3)}`;
    let value = cache.get(key);
    if (value === undefined) {
      tangent.set(Math.abs(normal.y) < .9 ? 0 : 1, Math.abs(normal.y) < .9 ? 1 : 0, 0).cross(normal).normalize();
      bitangent.crossVectors(normal, tangent);
      ray.origin.copy(position).addScaledVector(normal, bias);
      let blocked = 0;
      for (const sample of samples) {
        direction.copy(tangent).multiplyScalar(sample.x).addScaledVector(bitangent, sample.y).addScaledVector(normal, sample.z).normalize();
        ray.direction.copy(direction);
        const hit = collision.bvh.raycastFirst(ray, THREE.DoubleSide, .25, reach);
        if (hit) blocked += Math.sqrt(Math.max(0, 1 - hit.distance / reach));
      }
      rays += rayCount;
      value = Math.round(255 * Math.max(floor, 1 - strength * blocked / rayCount));
      cache.set(key, value);
    }
    ao[i] = value; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); sum += value;
  }
  geometry[fingerprint] = { offset, count: points.count, sourceMaterial: base };
  chunks.push(Buffer.from(ao)); offset += ao.byteLength; total += points.count;
  if (Object.keys(geometry).length % 12 === 0) console.log(JSON.stringify({ materials: Object.keys(geometry).length, vertices: total, uniqueSamples: cache.size, seconds: (performance.now() - started) / 1000 }));
}
const binary = Buffer.concat(chunks);
fs.mkdirSync(path.join(root, 'environment'), { recursive: true });
fs.writeFileSync(path.join(root, 'environment/contact-occlusion.bin'), binary);
const manifest = {
  version: 1, binary: 'environment/contact-occlusion.bin', byteLength: binary.byteLength,
  method: 'New static-world contact occlusion sampled against the existing collision BVH, multiplied into linear vertex colors. Not original T5 lightmaps. Dynamic brushes, alpha surfaces and helper meshes excluded.',
  parameters: { rays: rayCount, reach, floor, strength, bias }, geometry,
  provenance: {
    worldSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    collisionSha256: crypto.createHash('sha256').update(collisionBytes).digest('hex'),
    outputSha256: crypto.createHash('sha256').update(binary).digest('hex'),
  },
  stats: { meshes: Object.keys(geometry).length, vertices: total, uniqueSamples: cache.size, raycasts: rays,
    min: minimum / 255, max: maximum / 255, mean: sum / total / 255,
    bakeSeconds: (performance.now() - started) / 1000 },
};
fs.writeFileSync(path.join(root, 'environment-occlusion.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.stats));
