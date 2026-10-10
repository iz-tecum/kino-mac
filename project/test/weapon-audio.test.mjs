import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {GameAudio} from '../export/web/audio.js';
import {notifyKeys,shotPrefix,usesPapShot} from '../export/web/weapon-audio.js';
const data=JSON.parse(fs.readFileSync(new URL('../export/web/game-data.json',import.meta.url))),manifest=JSON.parse(fs.readFileSync(new URL('../export/web/audio/manifest.json',import.meta.url)));
const trace=()=>{const audio=new GameAudio(),events=[];audio.manifest=manifest;audio.play=(key,volume)=>events.push({key,volume});return{audio,events};};

test('LAW uses its recovered RPG alias; absent Commando, SPAS and Masterkey recordings are not falsely assigned another gun',()=>{
 const {audio,events}=trace();audio.weapon('shot',data.weapons.m72_law_zm);assert.equal(events.at(-1).key,'resident/wpn/rocket/rpg/plr/shot/wpn_rpg_shot_plr');
 for(const id of ['commando_zm','spas_zm']){audio.weapon('shot',data.weapons[id]);assert.equal(events.at(-1).key,'shot');}
 const masterkey={...data.weapons.aug_acog_zm.upgrade.attachment,id:'aug_acog_zm',attachmentActive:true};assert.equal(shotPrefix(masterkey),null);audio.weapon('shot',masterkey);assert.equal(events.at(-1).key,'shot');
});
test('PAP layers follow requested native aliases, not an upgraded flag on weapons with unchanged sounds',()=>{
 const {audio,events}=trace(),base=data.weapons.mp40_zm;audio.weapon('shot',base);assert.equal(events.length,1);
 audio.weapon('shot',{...base,...base.upgrade});assert.equal(events.length,5);assert.deepEqual(events.slice(-3).map(e=>e.key),['shared/wpn/pap/pap_shot_st','shared/wpn/pap/pap_flux_left','shared/wpn/pap/pap_flux_right']);
 assert(!usesPapShot({...data.weapons.m72_law_zm,...data.weapons.m72_law_zm.upgrade}));
});
test('native MP5 reload timeline resolves all magazine and charging notifies to the correct weapon recordings',()=>{
 const def=data.weapons.mp5k_zm,clip=JSON.parse(fs.readFileSync(new URL('../export/web/'+def.animations.reloadEmptyAnim,import.meta.url)));
 const names=clip.notifies.filter(n=>n.name.startsWith('sndnt#')).map(n=>n.name);assert(names.length>=4);
 for(const name of names){const keys=notifyKeys(manifest,name,def);assert(keys.length,name);if(name.startsWith('sndnt#wpn_mp5_'))assert(keys.every(k=>k.startsWith('resident/wpn/smg/mp5/reload/')),name);else assert(name.startsWith('sndnt#fly_gear_'),name);}
});
test('Python insert variants and shotgun shell families rotate without immediate repetition',()=>{
 const {audio,events}=trace();const python=notifyKeys(manifest,'sndnt#fly_python_single',data.weapons.python_zm);assert.equal(python.length,2);
 audio.notify('sndnt#fly_python_single',data.weapons.python_zm);audio.notify('sndnt#fly_python_single',data.weapons.python_zm);assert.notEqual(events[0].key,events[1].key);
 assert.equal(notifyKeys(manifest,'sndnt#fly_spas_shell_in',data.weapons.spas_zm).length,6);
});
test('bolt direction and EX41 actions resolve distinctly, while unprovided actions stay unresolved',()=>{
 assert.match(notifyKeys(manifest,'sndnt#fly_l96a1_bolt_up',{})[0],/fly_l96a1_bu$/);
 assert.match(notifyKeys(manifest,'sndnt#fly_l96a1_bolt_down',{})[0],/fly_l96a1_bd$/);
 assert.match(notifyKeys(manifest,'sndnt#fly_ex41_pull',{})[0],/fly_china_lake_back$/);
 assert.equal(notifyKeys(manifest,'sndnt#wpn_commando_mag_in',{}).length,0);
});
test('dry clicks use native category recordings and crossbow mechanism for the ballistic knife',()=>{
 const {audio,events}=trace();for(const [id,category]of [['m1911_zm','pistol'],['mp40_zm','smg'],['m16_zm','assault'],['rpk_zm','lmg'],['spas_zm','shotgun'],['knife_ballistic_zm','crossbow']]){audio.weapon('empty',data.weapons[id]);assert(events.at(-1).key.startsWith('shared/wpn/'+category+'/dry_fire/plr/'));}
});
test('Thundergun final-shot cue is selected only with an explicit final-shot state',()=>{
 const {audio,events}=trace();audio.weapon('shot',data.weapons.thundergun_zm);assert.match(events.at(-1).key,/fire_plr$/);audio.weapon('shot',data.weapons.thundergun_zm,null,{lastShot:true});assert.match(events.at(-1).key,/fire_last_plr$/);
});
test('all added shared files retain pinned upstream provenance and exact encoded hashes',()=>{
 const added=Object.values(manifest).filter(m=>m.sourceCommit==='9f871517d87fc702013ef6d9c920f0a23597c8bb');assert.equal(added.length,15);
 for(const m of added){const bytes=fs.readFileSync(new URL('../export/web/'+m.url,import.meta.url));assert.equal(bytes.subarray(0,4).toString(),'OggS');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),m.encodedSha256);assert(m.source.startsWith('zone/'));assert(m.sourceTreePath.startsWith('export/web/moon/audio/'));}
});
