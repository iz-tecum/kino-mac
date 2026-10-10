import fs from 'node:fs';
import crypto from 'node:crypto';
import {GameAudio} from '../export/web/audio.js';
import {notifyKeys,shotPrefix,dryFirePrefix,usesPapShot,papShotKeys} from '../export/web/weapon-audio.js';
const out='artifacts/v8-audio';fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync('export/web/game-data.json')),audio=new GameAudio();
audio.manifest=JSON.parse(fs.readFileSync('export/web/audio/manifest.json'));
const manifest=audio.manifest,rows=[];
for(const [id,base]of Object.entries(data.weapons))for(const variant of ['base','upgraded',...(base.upgrade?.attachment?['attachment']:[])]){
 const def=variant==='attachment'?{...base.upgrade.attachment,id,attachmentActive:true}:variant==='upgraded'?{...base,...base.upgrade,upgraded:true}:base;
 const actions=[];
 for(const [action,path]of Object.entries(def.animations)){
  const clip=JSON.parse(fs.readFileSync('export/web/'+path));
  for(const notify of clip.notifies??[])if(notify.name.startsWith('sndnt#'))actions.push({action,clip:path,notify:notify.name,time:notify.time,keys:notifyKeys(manifest,notify.name,def)});
 }
 const shot=shotPrefix(def),dry=dryFirePrefix(def);
 rows.push({id,variant,fireAlias:def.sounds?.fireSoundPlayer,shotKeys:shot?Object.keys(manifest).filter(k=>k.startsWith(shot)):[],papKeys:usesPapShot(def)?papShotKeys.filter(k=>manifest[k]):[],dryFireKeys:dry?Object.keys(manifest).filter(k=>k.startsWith(dry)):[],actions});
}
const summary={nativeCueAliases:Object.values(manifest).filter(m=>m.native!==false).length,communityCueAliases:Object.values(manifest).filter(m=>m.native===false).length,weaponVariants:rows.length,shotCoverage:rows.filter(r=>r.shotKeys.length).length,dryFireCoverage:rows.filter(r=>r.dryFireKeys.length).length,uniqueSoundNotifies:[...new Set(rows.flatMap(r=>r.actions.map(a=>a.notify)))].length,unresolvedSoundNotifies:[...new Set(rows.flatMap(r=>r.actions.filter(a=>!a.keys.length).map(a=>a.notify)))],shotFallbacks:rows.filter(r=>!r.shotKeys.length).map(r=>({id:r.id,variant:r.variant,alias:r.fireAlias})),dryFireFallbacks:rows.filter(r=>!r.dryFireKeys.length).map(r=>({id:r.id,variant:r.variant}))};
fs.writeFileSync(out+'/weapon-coverage.json',JSON.stringify({method:'Static resolution against every recovered native weapon animation notify; availability does not prove an event occurred in gameplay.',summary,weapons:rows},null,2));
const referenced=new Set(rows.flatMap(r=>[...r.shotKeys,...r.papKeys,...r.dryFireKeys,...r.actions.flatMap(a=>a.keys)]));
const stock=Object.keys(manifest).filter(k=>k.startsWith('resident/wpn/')&&!referenced.has(k));
fs.writeFileSync(out+'/unused-weapon-recordings.json',JSON.stringify({note:'Not selected by current weapon shot/dry/animation resolver. Some entries belong to absent weapons, extra layers, or separate knife/grenade hooks; this is not a list of all globally unused audio.',keys:stock},null,2));
const hashes={};for(const [key,m]of Object.entries(manifest))if(m.sourceCommit==='9f871517d87fc702013ef6d9c920f0a23597c8bb')hashes[key]=crypto.createHash('sha256').update(fs.readFileSync('export/web/'+m.url)).digest('hex');
fs.writeFileSync(out+'/new-asset-hashes.json',JSON.stringify(hashes,null,2));console.log(JSON.stringify(summary,null,2));
