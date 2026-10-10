// Recovered game-data sounds/notifies versus the resident recording filenames.
// These corrections keep the weapon and physical action the same. Missing
// Commando/SPAS/Masterkey source recordings are deliberately not substituted.
export const shotFolders={m1911:'pistol/m1911',m14:'assault/m14',rottweil72:'shotgun/rottweil72',ithaca:'shotgun/ithaca',
  mp40:'smg/mp40',mp5k:'smg/mp5',mpl:'smg/mpl',pm63:'smg/pm63',ak74u:'smg/ak74',m16:'assault/m16',
  galil:'assault/galil',commando:'assault/commando',hk21:'lmg/hk21',rpk:'lmg/rpk',python:'pistol/357',spas:'shotgun/spas',
  cz75:'pistol/cz75',cz75dw:'pistol/cz75',g11_lps:'smg/g11',famas:'assault/famas',spectre:'smg/spectre',hs10:'shotgun/hs10',aug_acog:'assault/aug',fnfal:'assault/fnfal',dragunov:'sniper/dragunov',l96a1:'sniper/l96a1',china_lake:'gren_launcher/china_lake',crossbow_explosive:'crossbow',knife_ballistic:'melee/ballistic_knife'};

export function shotPrefix(def){
  const alias=def.sounds?.fireSoundPlayer;
  if(alias==='wpn_rpg_fire_plr')return 'resident/wpn/rocket/rpg/plr/shot/wpn_rpg_shot_plr';
  if(alias==='wpn_gl_rifle_fire_plr')return 'resident/wpn/gren_launcher/attachment/plr/shot/';
  if(alias==='wpn_mk_fire_plr')return null;
  if(def.id==='ray_gun_zm')return 'resident/wpn/energy/raygun/plr/shot/ray_shot_f';
  if(def.id==='thundergun_zm')return 'resident/wpn/energy/thundergun/plr/shot/wpn_thundergun_fire_plr';
  const folder=shotFolders[def.id?.replace('_zm','')];
  return folder?'resident/wpn/'+folder+'/plr/shot/shot_':null;
}

// The uploaded reimagined.all.csv preserves the native pap_shot_st ->
// pap_flux_left -> pap_flux_right -> base-shot chain for its added PAP guns.
// Apply that shared native layer only when the weapon actually requests _pap.
export const papShotKeys=['shared/wpn/pap/pap_shot_st','shared/wpn/pap/pap_flux_left','shared/wpn/pap/pap_flux_right'];
export const usesPapShot=def=>/_pap(?:_|$)/.test(def.sounds?.fireSoundPlayer??'');

export function dryFirePrefix(def){
  const folder=shotFolders[def.id?.replace('_zm','')];
  if(def.sounds?.emptyFireSoundPlayer==='wpn_crossbow_dryfire_plr')return 'shared/wpn/crossbow/dry_fire/plr/';
  if(def.attachmentActive&&def.projectileSpeed>0)return null;
  if(def.attachmentActive&&def.pellets>1)return 'shared/wpn/shotgun/dry_fire/plr/';
  const category=folder?.split('/')[0];
  if(['pistol','smg','assault','lmg','shotgun'].includes(category))return 'shared/wpn/'+category+'/dry_fire/plr/';
  // Supplied native aliases use the LMG dry click for bolt/sniper rifles.
  if(category==='sniper')return 'shared/wpn/lmg/dry_fire/plr/';
  return null;
}

const exact={
  wpn_rottweil72_switch:'fly_rott_switch',wpn_rottweil72_open:'fly_rott_open',wpn_rottweil72_shell_in:'fly_rott_shell_in',wpn_rottweil72_close:'fly_rott_close',
  wpn_ray_reload_battery_in:'wpn_ray_reload_battery',wpn_raygun_raise_buttons:'activate',wpn_raygun_raise_hit:'hit',
  fly_thundergun_cell_lock:'fly_thundergun_cell_slide_lock',
  fly_python_single:'fly_357_single_bullet',fly_python_open:'fly_357_open',fly_python_empty:'fly_357_empty',fly_python_close:'fly_357_close',fly_python_spin:'fly_357_spin',fly_python_load:'fly_357_load',
  fly_dragunov_bolt_back:'fly_dragunov_pull',fly_dragunov_bolt_release:'fly_dragunov_release',
  fly_l96a1_bolt_up:'fly_l96a1_bu',fly_l96a1_bolt_back:'fly_l96a1_bb',fly_l96a1_bolt_forward:'fly_l96a1_bf',fly_l96a1_bolt_down:'fly_l96a1_bd',
  wpn_rpg_lock:'fly_rpg_latch',fly_ex41_pull:'fly_china_lake_back',fly_ex41_push:'fly_china_lake_forward',fly_ex41_sight_up:'fly_china_lake_sight_up',
  fly_gl_open:'fly_grenlaunch_open',fly_gl_gren_out:'fly_grenlaunch_gren_out',fly_gl_gren_in:'fly_grenlaunch_gren_in',fly_gl_close:'fly_grenlaunch_close',
  fly_crossbow_place_bolt:'fly_crossbow_lay_bolt',fly_bal_knife_load:'bal_knife_load',
};
const byPrefix={
  fly_ithaca_shell_in:'resident/wpn/shotgun/foley/load/',fly_spas_shell_in:'resident/wpn/shotgun/foley/load/',fly_hs10_shell_in:'resident/wpn/shotgun/foley/load/',
  fly_ex41_shell_in:'resident/wpn/gren_launcher/china_lake/foley/load/',
  fly_mk_shell_in:'resident/wpn/shotgun/foley/load/',
  wpn_raygun_raise_buttons:'shared/wpn/energy/raygun/raise/activate',wpn_raygun_raise_hit:'shared/wpn/energy/raygun/raise/hit',
};
const leafMatch=(key,name)=>{const leaf=key.slice(key.lastIndexOf('/')+1);return leaf===name||leaf.startsWith(name+'_')&&/^\d+$/.test(leaf.slice(name.length+1));};
export function notifyKeys(manifest,name,def={}){
  if(name.startsWith('rmbnt#'))return [];
  name=def.notetrackSounds?.[name]??name.replace(/^sndnt#/,'');
  if(['bowie_swing','bowie_stab'].includes(name))return [];
  const bottle={evt_perk_bottle_open:'open/openmn_00',bottle_open:'open/openmn_00',evt_perk_swallow:'swallow/swallowmn_00',swallow:'swallow/swallowmn_00',evt_bottle_break:'break/breakmn_00',bottle_break:'break/breakmn_00',evt_belch:'belch/belchmn_00',belch:'belch/belchmn_00'}[name];
  if(bottle){const key='resident/evt/zombie_global/perksacola/bottle/'+bottle;return manifest[key]?[key]:[];}
  const prefix=byPrefix[name];if(prefix)return Object.keys(manifest).filter(k=>k.startsWith(prefix));
  const resolved=exact[name]??name,aliases=[resolved,resolved.replace(/_plr$/,''),resolved.replace(/^wpn_/,'fly_')];
  for(const alias of aliases){const keys=Object.keys(manifest).filter(k=>leafMatch(k,alias));if(keys.length)return keys;}
  return [];
}
