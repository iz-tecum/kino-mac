import {chromium} from 'playwright-core';
import fs from 'node:fs';
import {resolveChromeExecutable} from './browser-path.mjs';
const out='artifacts/v8-machines/baseline';fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch({executablePath:resolveChromeExecutable(),headless:true});
const page=await b.newPage({viewport:{width:1440,height:900}});const errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.route('**/game.js',async route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('export/web/game.js','utf8')+'\nglobalThis.__machineAudit={world,data,scene,THREE};'}));
try{
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>kino?.debug.getState().ready,null,{timeout:120000});
 const objects=await page.evaluate(()=>{const {world,data,THREE}=__machineAudit;return data.entities.filter(e=>/teleporter_indicator|teleporter_link_cable|zom_clock_/.test(e.targetname??'')).map(e=>{const root=world.entities.get(e.id),box=root?new THREE.Box3().setFromObject(root):null;return {entity:e,found:!!root,visible:root?.visible,box:box?{min:box.min.toArray(),max:box.max.toArray()}:null,meshes:root?[...function*(){const a=[];root.traverse(m=>{if(m.isMesh)a.push({name:m.name,material:[m.material].flat().map(x=>({name:x.name,color:x.color?.getHexString(),map:x.map?.name}))})});yield* a;}()]:[]};});});
 await page.click('#start');await page.waitForFunction(()=>kino.debug.getState().active);
 await page.evaluate(()=>{kino.debug.setAutoSpawn(false);kino.debug.setInvulnerable(true);kino.debug.teleportPlayer([-110,320,325]);kino.debug.step(.2);kino.debug.lookAt([4,423,505]);});
 await page.waitForTimeout(900);await page.screenshot({path:out+'/projection-clock.png'});
 fs.writeFileSync(out+'/report.json',JSON.stringify({objects,errors},null,2));console.log(JSON.stringify({objects,errors}));
}finally{await b.close()}
