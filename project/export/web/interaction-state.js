// Presentation is derived from the selected, in-range authoritative target.
// This module never spends points, repairs boards, or advances a transaction.
export function describeInteraction({target:e,session:s,data,doors,perks,mysteryBox,features,traps,repairLeft=0,holding=false,key='F',teleportPending=0,cooldownUntil=0,linkUntil=0,fallback=''}){
  if(!e)return null;
  const p={id:e.barrier?'barrier-'+e.barrier.id:String(e.id),kind:'interaction',title:fallback,action:'Use',points:s.points,available:true,key};
  const lock=reason=>{p.available=false;p.reason=reason;};
  const purchase=(cost,action)=>{p.cost=cost;p.action=action;if(s.points<cost)lock('Not enough points');};
  const replaced=()=>s.inventory.filter(w=>!w.lost).length>=2?'Replaces '+((s.weapon.upgraded?data.weapons[s.weapon.id]?.upgrade?.name:data.weapons[s.weapon.id]?.name)??'held weapon'):'Adds to your loadout';
  if(e.barrier){
    const b=e.barrier,total=b.boards.length||6;
    Object.assign(p,{kind:'repair',title:'Window barricade',action:'Rebuild',detail:'Keep the dead outside',hold:true,holding:holding&&!s.busy,count:b.count,total,progress:holding?Math.max(0,Math.min(1,1-repairLeft/.75)):0});
    if(b.count>=total){p.detail='All boards in place';lock('Barricade secured');p.progress=1;}
  }else switch(e.targetname){
    case 'weapon_upgrade':{
      const d=data.weapons[e.zombie_weapon_upgrade];if(!d)return null;
      const owned=s.inventory.find(w=>w.id===d.id&&!w.lost),def=owned?.upgraded?{...d,...d.upgrade}:d;
      Object.assign(p,{kind:owned?'ammo':'weapon',title:owned?def.name:d.name,detail:owned?'Reserve ammunition · '+owned.reserve+' / '+def.maxAmmo:replaced()});
      purchase(owned?(owned.upgraded?4500:d.ammoPrice??Math.ceil(d.price/2)):d.price,owned?'Refill ammo':'Buy weapon');
      if(owned&&owned.reserve>=def.maxAmmo)lock('Reserve ammo full');
      if(s.pack?.weapon===s.weapon||s.pack?.weapon.id===d.id)lock('Weapon is in Pack-a-Punch');
      break;
    }
    case 'zombie_door':{
      const d=doors.get(e.target);if(!d)return null;
      Object.assign(p,{kind:'door',title:'Open the way',detail:'Unlock the next area'});purchase(d.cost,'Open door');
      if(d.electric)lock('Restore the power first');break;
    }
    case 'zombie_vending':{
      const info=perks[e.script_noteworthy];if(!info)return null;
      const description={specialty_armorvest:'Take more hits',specialty_fastreload:'Reload faster',specialty_rof:'Fire faster',specialty_quickrevive:'A second chance when downed'};
      Object.assign(p,{kind:'perk',title:info.name,detail:description[e.script_noteworthy]});purchase(info.price,'Buy perk');
      if(s.perks.has(e.script_noteworthy))lock('Already equipped');
      else if(!s.power&&e.script_noteworthy!=='specialty_quickrevive')lock('Restore the power first');
      else if(e.script_noteworthy==='specialty_quickrevive'&&s.quickReviveDepleted)lock('No revives remaining');
      break;
    }
    case 'use_elec_switch':Object.assign(p,{kind:'power',title:'Restore the power',action:'Activate',detail:'Bring the theater back to life'});break;
    case 'bowie_upgrade':Object.assign(p,{kind:'weapon',title:'Bowie Knife',detail:'Replace your starting knife'});purchase(3000,'Buy knife');if(s.bowie)lock('Already equipped');break;
    case 'treasure_chest_use':{
      const roll=mysteryBox.at(e),box=mysteryBox.boxes.get(e.id);Object.assign(p,{kind:'box',title:'Mystery Box',detail:'A chance at a new weapon'});
      if(roll){
        if(roll.teddy){p.detail='Find its new location';lock('The box is moving');}
        else if(!roll.ready){p.detail='Your weapon is on its way';lock('Choosing a weapon');}
        else {p.title=(data.weapons[roll.weapon]??data.equipment[roll.weapon]).name;p.action='Take weapon';p.detail=Math.max(0,Math.ceil(roll.expires-s.time))+' seconds to claim';if(s.pack?.weapon===s.weapon)lock('Switch away from the upgrading weapon');}
      }else {purchase(s.effects.fire_sale>s.time?10:950,'Try your luck');if(box?.closing)lock('Box is closing');}
      break;
    }
    case 'zombie_vending_upgrade':{
      Object.assign(p,{kind:'upgrade',title:'Pack-a-Punch',detail:'Transform your held weapon'});
      if(s.pack){
        if(s.time<s.pack.readyAt){p.detail='Ready in '+Math.ceil(s.pack.readyAt-s.time)+' seconds';lock('Upgrading your weapon');}
        else{p.title=data.weapons[s.pack.weapon.id].upgrade.name;p.action='Retrieve weapon';p.detail=Math.max(0,Math.ceil(s.pack.expires-s.time))+' seconds to retrieve';}
      }else{purchase(5000,'Upgrade weapon');if(!s.power)lock('Restore the power first');else if(s.weaponUnavailable)lock('Equip a weapon first');else if(s.weapon.upgraded)lock('Already upgraded');else if(!data.weapons[s.weapon.id]?.upgrade)lock('This weapon cannot be upgraded');}
      break;
    }
    case 'trigger_teleport_pad_0':{
      Object.assign(p,{kind:'teleport',title:'Stage teleporter',action:'Begin link',detail:'Link to the lobby mainframe'});
      if(!s.power)lock('Restore the power first');
      else if(teleportPending){p.detail='Remain on the pad';lock('Departing in '+Math.max(0,Math.ceil(teleportPending-s.time))+' seconds');}
      else if(s.teleporter==='linked'){p.action='Teleport';p.detail='Visit the projection room';}
      else if(s.teleporter==='linking'){p.detail=Math.max(0,Math.ceil(linkUntil-s.time))+' seconds to link';lock('Activate the lobby pad');}
      else if(s.teleporter==='cooldown'){p.detail='Wait for the coils to recharge';lock('Cooling down · '+Math.max(0,Math.ceil(cooldownUntil-s.time))+'s');}
      break;
    }
    case 'pf16_auto1':Object.assign(p,{kind:'teleport',title:'Lobby mainframe',action:'Complete link',detail:'Connect to the stage teleporter'});if(s.teleporter!=='linking')lock('Begin the link on the stage');break;
    case 'claymore_purchase':Object.assign(p,{kind:'equipment',title:'Claymores',detail:'Two mines · replenished between rounds'});purchase(1000,'Buy equipment');if(s.claymoresOwned)lock('Equipped · press 4 to place');break;
    case 'meteor_egg_trigger':Object.assign(p,{kind:'discovery',title:'Meteor fragment',action:'Listen',detail:'Something is resonating inside'});break;
    case 'trigger_change_projector_reels':Object.assign(p,{kind:'discovery',title:'Film projector',action:'Load reel',detail:features.events.installed.size+' / 3 films projected'});if(!features.events.carried)lock('Find a film reel first');break;
    default:
      if(e.targetname?.endsWith('_room_trap')){
        const t=traps.traps.get(e.targetname);if(!t)return null;Object.assign(p,{kind:'trap',title:t.type==='fire'?'Fire trap':'Electric trap',detail:'Keep clear while active'});purchase(traps.rules.cost,'Activate trap');
        if(!s.power)lock('Restore the power first');else if(t.end>s.time)lock('Active · '+Math.ceil(t.end-s.time)+'s');else if(t.cooldown>s.time)lock('Cooling down · '+Math.ceil(t.cooldown-s.time)+'s');
      }else if(e.script_noteworthy==='auto_turret_trigger'){
        Object.assign(p,{kind:'trap',title:'Automatic turret',detail:'30 seconds of covering fire'});purchase(1500,'Activate turret');if(!s.power)lock('Restore the power first');else if(features.turrets.some(t=>t.id===e.id&&t.until>s.time))lock('Turret active');
      }else if(e.targetname?.startsWith('trigger_movie_reel_'))Object.assign(p,{kind:'discovery',title:'Film reel',action:'Take reel',detail:'Bring it to the projection room'});
  }
  if(s.busy){lock(s.drinking?'Finish drinking first':s.phase==='reviving'?'Reviving…':'Finish your current action');p.holding=false;}
  return p;
}
