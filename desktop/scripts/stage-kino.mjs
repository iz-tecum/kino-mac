import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const [sourceArg, destinationArg] = process.argv.slice(2);
assert(sourceArg && destinationArg, 'Usage: node stage-kino.mjs SOURCE_WEB NEW_DESTINATION');
const source = path.resolve(sourceArg), destination = path.resolve(destinationArg);
assert(!fs.existsSync(destination), 'Use a new staging directory');
fs.mkdirSync(destination, {recursive:true});
const included = new Map();
function copy(relative) {
  assert(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'));
  if (included.has(relative)) return;
  const input = path.join(source, relative), stat = fs.lstatSync(input);
  assert(!stat.isSymbolicLink(), `Unexpected symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(input)) copy(path.join(relative,name));
  } else {
    assert(!fs.readFileSync(input).subarray(0,128).toString().startsWith('version https://git-lfs.github.com/spec/v1'), `Unresolved LFS: ${relative}`);
    const output = path.join(destination,relative);
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.copyFileSync(input,output);
    included.set(relative,stat.size);
  }
}
const modules = new Set();
function module(relative) {
  if(modules.has(relative)) return;
  modules.add(relative); copy(relative);
  const code = fs.readFileSync(path.join(source,relative),'utf8');
  for(const match of code.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
    module(path.posix.normalize(path.posix.join(path.posix.dirname(relative),match[1])));
}
module('game.js');
for(const file of ['index.html','style.css','desktop-settings.css','touch-controls.css','game-data.json','navigation.bin','kino.gltf','collision.json','environment-materials.json','environment-occlusion.json','surface-index.json','theater-light-plan.json','theater-irradiance.json','theater-daylight.json','theater-surface-light.json','theater-dressing.json']) copy(file);
const gltf = JSON.parse(fs.readFileSync(path.join(source,'kino.gltf')));
for(const buffer of gltf.buffers) copy(buffer.uri);
const collision = JSON.parse(fs.readFileSync(path.join(source,'collision.json')));
if(collision.binary) copy(collision.binary);
for(const part of collision.binaryParts??[]) copy(part.uri);
for(const directory of ['animations','audio','models','textures','textures-mobile','vendor','social','environment']) copy(directory);
console.log(JSON.stringify({files:included.size,bytes:[...included.values()].reduce((a,b)=>a+b,0),modules:[...modules],map:'kino'},null,2));
