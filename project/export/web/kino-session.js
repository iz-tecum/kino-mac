import { Session } from './rules.js';
import { GAME_PROFILES, resolveGameProfile } from './game-profiles.js';

export const KINO_PERK_PRICES=Object.freeze({specialty_quickrevive:500,specialty_fastreload:3000,specialty_rof:2000,specialty_armorvest:2500});
export const KINO_PACK_RULES=Object.freeze({cost:5000,process:4.35,retrieval:15});

// Kino-only inventory rules; Moon keeps its separate progression state.
export class KinoSession extends Session {
  constructor(data, random=Math.random, options={profile:'classic'}) {
    super(data,random);
    this.setProfile(options.profile??'classic');
    this._runProfile=this._nextProfile;
  }
  get profile(){return this._runProfile;}
  // A selection is applied only at reset, never midway through a run.
  setProfile(id){this._nextProfile=resolveGameProfile(id);return this._nextProfile;}
  reset(){this._runProfile=this._nextProfile??GAME_PROFILES.classic;this._damageRecoveryDelay=null;super.reset();this.pack=null;this.quickRevivePurchases=0;this.claymoresOwned=false;this.claymores=0;this.monkeysOwned=false;this.monkeys=0;this.equipmentLeft=0;this.attachmentMode=false;}
  get def(){
    const w=this.weapon,d=this.data.weapons[w.id],base=w.upgraded?{...d,...d.upgrade,id:w.id,upgraded:true}:d;
    if(w.lost)return {...base,name:'No weapon',clipSize:0,maxAmmo:0};
    return this.attachmentMode&&base.attachment?{...base.attachment,id:base.id,name:base.name+' · '+base.attachment.name,attachmentActive:true}:base;
  }
  get weaponUnavailable(){return !!this.weapon.lost||!!(this.pack?.weapon===this.weapon);}
  get busy(){return ['gameover','reviving'].includes(this.phase)||!!this.drinking||this.meleeLeft>0||this.equipmentLeft>0;}
  get quickReviveDepleted(){return this.quickRevivePurchases>=3;}
  canBuyPerk(id){
    const price=KINO_PERK_PRICES[id];
    return price!==undefined&&!!this.data.perkDrinks?.[id]&&!this.busy&&!this.perks.has(id)&&
      (id==='specialty_quickrevive'?!this.quickReviveDepleted:this.power)&&this.points>=price;
  }
  buyPerk(id){
    // Charge only after the bottle action is accepted; downing cancels its grant.
    if(!this.canBuyPerk(id)||!this.drink(id))return false;
    this.spend(KINO_PERK_PRICES[id]);return true;
  }
  drink(id){return !(id==='specialty_quickrevive'&&this.quickReviveDepleted)&&super.drink(id);}
  finishPerkDrink(){
    const perk=super.finishPerkDrink();
    // Classic solo grant count, retained in the commented stock block of
    // BO1-Reimagined maps/_zombiemode_perks.gsc:give_perk/solo_revive_buy_trigger_move.
    // The optional recovery profile does not adopt the mod's changed life system.
    if(perk==='specialty_quickrevive')this.quickRevivePurchases++;
    return perk;
  }
  update(dt){
    if(this.phase==='gameover')return;
    if(this.profile.recovery&&(!Number.isFinite(dt)||dt<=0))return;
    this.equipmentLeft=Math.max(0,this.equipmentLeft-dt);super.update(dt);
    if(this.pack&&this.time>=this.pack.expires){this.expirePack();this.lastEvent='Pack-a-Punch weapon expired';}
  }
  damage(n){
    const recovery=this.profile.recovery;
    if(recovery&&(!Number.isFinite(n)||n<=0))return false;
    const changed=super.damage(n);
    if(changed&&recovery&&this.health>0){
      // BO1-Reimagined maps/_gameskill.gsc latches veryHurt after damage.
      // Keep this hit's delay when recovery later crosses the critical threshold.
      const delay=this.health/this.maxHealth<=recovery.criticalFraction?recovery.criticalDelay:recovery.normalDelay;
      this._damageRecoveryDelay=delay/(this.perks.has('specialty_quickrevive')?recovery.quickReviveDivisor:1);
    }
    if(['reviving','gameover'].includes(this.phase)){this.cancelReload();this.meleeLeft=0;this.equipmentLeft=0;}
    // A down still permits recovery and a later claim within the original timer.
    // A finished run has no owner who can retrieve the reserved weapon.
    if(this.phase==='gameover')this.expirePack();
    return changed;
  }
  regenerateHealth(dt){
    const recovery=this.profile.recovery;
    if(!recovery)return super.regenerateHealth(dt);
    const readyAt=this.damageTime+(this._damageRecoveryDelay??recovery.normalDelay);
    // Count only simulation time after the delay, including a frame straddling it.
    const elapsed=Math.max(0,Math.min(dt,this.time-readyAt));
    this.health=Math.min(this.maxHealth,this.health+elapsed*recovery.healthPerSecond);
  }
  fire(){return !this.busy&&!this.weaponUnavailable&&super.fire();}
  reload(){return !this.busy&&!this.weaponUnavailable&&super.reload();}
  switchWeapon(slot){
    if(this.busy||this.inventory.length<2)return false;
    // The reserved object preserves its return slot, but is no longer a carried
    // weapon. Cycling must not equip that object or a weapon lost to the machine.
    const target=slot??this.inventory.findIndex((w,i)=>i!==this.slot&&this.canEquip(w));
    if(!Number.isInteger(target)||target<0||target>=this.inventory.length||target===this.slot)return false;
    if(!this.canEquip(this.inventory[target]))return false;
    this.leaveAttachment();super.switchWeapon(target);return true;
  }
  canEquip(weapon){return !!weapon&&!weapon.lost&&weapon!==this.pack?.weapon;}
  canReceiveWeapon(id){
    if(this.busy||!this.data.weapons[id]||this.pack?.weapon.id===id)return false;
    if(this.inventory.some(w=>w.lost||w.id===id&&!w.lost))return true;
    return this.inventory.length<2||this.pack?.weapon!==this.weapon;
  }
  giveWeapon(id){
    if(!this.canReceiveWeapon(id))return false;
    this.leaveAttachment();
    // Custody reserves its slot, but an unused/lost second slot can receive a
    // real gun even when the deposited placeholder is currently selected.
    const lost=this.inventory.findIndex(w=>w.lost);
    if(this.inventory.some(w=>w.id===id&&!w.lost)){super.giveWeapon(id);return true;}
    if(lost>=0){this.inventory[lost]={id,mag:this.data.weapons[id].clipSize,reserve:this.data.weapons[id].maxAmmo,upgraded:false};this.slot=lost;this.cancelReload();return true;}
    super.giveWeapon(id);return true;
  }
  beginPack(){
    if(this.busy||this.pack||this.weaponUnavailable||!this.power||this.weapon.upgraded||!this.data.weapons[this.weapon.id].upgrade||!this.spend(KINO_PACK_RULES.cost))return false;
    this.leaveAttachment();this.cancelReload();
    this.pack={weapon:this.weapon,startedAt:this.time,readyAt:this.time+KINO_PACK_RULES.process,expires:this.time+KINO_PACK_RULES.process+KINO_PACK_RULES.retrieval};
    // Native upgrade_knuckle_crack_end returns to a remaining primary. This
    // browser adaptation changes immediately because no knuckle clip is loaded.
    const fallback=this.inventory.findIndex(w=>this.canEquip(w));
    if(fallback>=0)super.switchWeapon(fallback);
    return true;
  }
  takePack(){
    if(this.busy||!this.pack||this.time<this.pack.readyAt||this.time>=this.pack.expires)return false;
    this.leaveAttachment();const w=this.pack.weapon;w.upgraded=true;this.slot=this.inventory.indexOf(w);this.pack=null;
    w.mag=this.def.clipSize;w.reserve=this.def.maxAmmo;this.cancelReload();this.fireLeft=this.def.raiseTime??.4;return true;
  }
  expirePack(){
    if(!this.pack)return false;
    this.pack.weapon.lost=true;this.pack.weapon.mag=0;this.pack.weapon.reserve=0;this.pack=null;return true;
  }
  buyClaymores(){if(this.busy||this.claymoresOwned||!this.spend(1000))return false;this.claymoresOwned=true;this.claymores=2;return true;}
  giveMonkeys(){if(this.busy)return false;this.monkeysOwned=true;this.monkeys=3;return true;}
  useEquipment(kind){if(!['claymores','monkeys'].includes(kind)||this.busy||this[kind]<=0)return false;this[kind]--;this.equipmentLeft=.8;this.cancelReload();return true;}
  nextRound(){super.nextRound();if(this.claymoresOwned)this.claymores=Math.min(2,this.claymores+2);}
  powerup(type){
    super.powerup(type);
    if(type==='full_ammo'){
      // Base Session refills every stored slot; an expired PaP slot is only an
      // inventory placeholder and cannot receive ammunition from a later drop.
      for(const w of this.inventory)if(w.lost){w.mag=0;w.reserve=0;}
      if(this.claymoresOwned)this.claymores=2;if(this.monkeysOwned)this.monkeys=3;
      for(const w of this.inventory){const a=this.data.weapons[w.id].upgrade?.attachment;if(w.upgraded&&a&&w.attachmentAmmo)w.attachmentAmmo.reserve=a.maxAmmo;}
      if(this.attachmentMode){this.weapon.primaryAmmo.reserve=this.data.weapons[this.weapon.id].upgrade.maxAmmo;this.weapon.reserve=this.def.maxAmmo;}
    }
  }
  toggleAttachment(){
    if(this.busy||this.weaponUnavailable)return false;
    if(this.attachmentMode){this.leaveAttachment();this.fireLeft=.3;return true;}
    const a=this.def.attachment;if(!a)return false;
    const w=this.weapon;w.primaryAmmo={mag:w.mag,reserve:w.reserve};w.attachmentAmmo??={mag:a.clipSize,reserve:a.maxAmmo};
    Object.assign(w,w.attachmentAmmo);this.attachmentMode=true;this.cancelReload();this.fireLeft=.3;return true;
  }
  leaveAttachment(){if(!this.attachmentMode)return;const w=this.weapon;w.attachmentAmmo={mag:w.mag,reserve:w.reserve};Object.assign(w,w.primaryAmmo);this.attachmentMode=false;this.cancelReload();}
  snapshot(){return {...super.snapshot(),profile:this.profile.id,profileLabel:this.profile.label,quickRevivePurchases:this.quickRevivePurchases,quickReviveDepleted:this.quickReviveDepleted,claymores:this.claymores,claymoresOwned:this.claymoresOwned,monkeys:this.monkeys,monkeysOwned:this.monkeysOwned,equipmentLeft:this.equipmentLeft,attachmentMode:this.attachmentMode,weaponUnavailable:this.weaponUnavailable,pack:this.pack?{id:this.pack.weapon.id,state:this.time>=this.pack.readyAt?'ready':'processing',ready:this.time>=this.pack.readyAt,readyIn:Math.max(0,this.pack.readyAt-this.time),expiresIn:this.pack.expires-this.time}:null};}
}
