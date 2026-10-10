// Community recording families follow pinned NZ:P zombie_core/dog_core usage.
// Nova's higher-pitched crawler-family adaptation is explicitly approximate.
import { surfaceFromMaterial } from './audio-surfaces.js';
const prefix='enemy/nzp/';
const families={
  zombie:{ambient:['zombie/w','zombie/t'],sprint:['zombie/r'],attack:['zombie/a'],teardown:['zombie/t'],behind:['zombie/r'],death:['zombie/d'],spawn:['zombie/w']},
  nova:{ambient:['zombie/t'],sprint:['zombie/t'],attack:['zombie/a'],teardown:['zombie/t'],behind:['zombie/r'],death:['zombie/d'],spawn:['zombie/t']},
  dog:{ambient:['@dog'],sprint:['hound/t'],attack:['hound/a'],behind:['hound/t'],death:['hound/d'],spawn:['hound/t']},
};
const priorities={ambient:0,sprint:0,spawn:0,step:0,teardown:1,barrier:1,behind:2,attack:2,death:3};
const toArray=p=>Array.isArray(p)?p.slice():p&&[p.x,p.y,p.z];

export function enemyCueKeys(manifest,kind,event){
  const bank=event==='barrier'?['barrier/barricade_destroy']:families[kind]?.[event]??[];
  return Object.keys(manifest).filter(key=>bank.some(p=>p.startsWith('@')?key===p.slice(1):key.startsWith(prefix+p)));
}
export function enemyFootstepKeys(manifest,surface,speed=0){
  const material=surfaceFromMaterial(surface),gaits=speed>110?['sprint','run','walk']:['walk','run'];
  for(const gait of gaits){const keys=Object.keys(manifest).filter(k=>k.startsWith('shared/fly/footsteps/'+gait+'/'+material+'/'));if(keys.length)return keys;}
  return Object.keys(manifest).filter(k=>k.startsWith('shared/fly/footsteps/walk/concrete/'));
}

// A per-run audio PRNG is independent of gameplay/spawn randomness.
const hash=value=>{let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}h=Math.imul(h^h>>>16,0x7feb352d);h=Math.imul(h^h>>>15,0x846ca68b);return(h^h>>>16)>>>0;};
export function enemyVoiceProfile(id,kind,seed=0){
  const identity=hash(seed+':'+kind+':'+id),pitch=.965+(identity&65535)/65535*.07;
  return{identity,pitch,level:.92+(identity>>>16)/65535*.08};
}
export class EnemyAudio {
  constructor(audio,{random=Math.random,maxVoices=10,seed=Math.floor(random()*4294967295)}={}){this.audio=audio;this.seed=seed>>>0;this.randomState=this.seed;this.bags=new Map();this.retiring=new Map();this.maxVoices=maxVoices;this.entries=new Map();this.cooldowns=new Map();this.last=new Map();this.stepBanks=new Map();this.behindAt=0;this.accepted=0;this.suppressed=0;this.occlusionChecks=0;}
  random(){let n=this.randomState=(this.randomState+0x6D2B79F5)>>>0;n=Math.imul(n^n>>>15,n|1);n^=n+Math.imul(n^n>>>7,n|61);return((n^n>>>14)>>>0)/4294967296;}
  select(bank,keys){
    let bag=this.bags.get(bank);if(!bag?.length){bag=keys.slice();for(let i=bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
      if(bag.length>1&&bag.at(-1)===this.last.get(bank))[bag[0],bag[bag.length-1]]=[bag.at(-1),bag[0]];this.bags.set(bank,bag);}
    const key=bag.pop();if(key)this.last.set(bank,key);return key;
  }
  stop(entry,fade=0){
    entry.controller.abort();if(this.entries.get(entry.slot)===entry)this.entries.delete(entry.slot);
    if(!fade)for(const [source,retired]of this.retiring)if(retired.id===entry.id)this.audio.stopSource(source);
    if(!entry.source)return entry.transition??null;
    const source=entry.source;if(fade)this.retiring.set(source,entry);
    return this.audio.stopSource(source,fade).finally(()=>this.retiring.delete(source));
  }
  prune(){for(const entry of this.entries.values())if(entry.source&&!this.audio.sourceVoices.has(entry.source))this.entries.delete(entry.slot);}
  remove(id){for(const entry of [...this.entries.values()])if(entry.id===id)this.stop(entry);for(const [source,entry]of this.retiring)if(entry.id===id)this.audio.stopSource(source);for(const key of this.cooldowns.keys())if(key.startsWith(id+':'))this.cooldowns.delete(key);}
  reset(){for(const entry of [...this.entries.values()])this.stop(entry);for(const source of this.retiring.keys())this.audio.stopSource(source);this.retiring.clear();this.cooldowns.clear();this.last.clear();this.bags.clear();this.randomState=this.seed;this.behindAt=0;this.accepted=this.suppressed=this.occlusionChecks=0;}
  acoustics(entry,force=false){
    const now=this.audio.ctx?.currentTime??0;if(!force&&now<entry.acousticAt)return;
    entry.acousticAt=now+.2;entry.occlusion=this.audio.occlusionAt(entry.position);this.occlusionChecks++;this.audio.setSourceOcclusion(entry.source,entry.occlusion);
  }
  emit(event,position,meta={}){
    if(event==='reset'){this.reset();return false;}
    if(event==='remove'){this.remove(meta.id);return false;}
    const audio=this.audio,p=toArray(position),kind=meta.kind??'zombie',id=meta.id;
    if(!Number.isFinite(id)||p?.length!==3||!p.every(Number.isFinite))return false;
    this.prune();
    const height=kind==='zombie'?48:kind==='dog'?23:20;
    if(event==='update'){for(const entry of this.entries.values())if(entry.id===id){const at=p.slice();at[1]+=entry.event==='barrier'?25:entry.event==='step'?4:height;entry.position=at;audio.moveSource(entry.source,at);this.acoustics(entry);}return false;}
    p[1]+=event==='barrier'?25:event==='step'?4:height;
    if(!audio.ctx||audio.paused||!audio.enabled||!audio.acceptPlayback||audio.mix.effects===0||audio.mix.master===0)return false;
    const now=audio.ctx.currentTime,listener=audio.listenerState;
    const distance=listener?Math.hypot(...p.map((n,i)=>n-listener.position[i])):0;
    if(distance>(event==='step'?500:['ambient','sprint','spawn'].includes(event)?950:1400)){this.suppressed++;return false;}
    if(event==='ambient'&&listener&&kind!=='dog'&&distance<220&&distance>1&&now>=this.behindAt){
      const direction=p.map((n,i)=>(n-listener.position[i])/distance);
      if(direction.reduce((n,v,i)=>n+v*listener.forward[i],0)<-.087)event='behind';
    }
    const slot=id+(event==='barrier'?':barrier':event==='step'?':step':':vocal'),priority=priorities[event];
    if(priority===undefined)return false;
    const cooldown=id+':'+event;
    if(now<(this.cooldowns.get(cooldown)??0)){this.suppressed++;return false;}
    const previous=this.entries.get(slot);
    if(previous&&(previous.priority>priority||priority<=1&&previous.priority===priority)){this.suppressed++;return false;}
    const stepBank=surfaceFromMaterial(meta.surface)+':'+(meta.speed>110?'sprint':'walk');
    if(event==='step'&&!this.stepBanks.has(stepBank))this.stepBanks.set(stepBank,enemyFootstepKeys(audio.manifest,meta.surface,meta.speed));
    const keys=event==='step'?this.stepBanks.get(stepBank):enemyCueKeys(audio.manifest,kind,event),bank=kind+':'+event+(event==='step'?':'+stepBank:'');
    if(!keys.length)return false;
    let transition=previous?this.stop(previous,.018):null;
    if(event==='step'&&[...this.entries.values()].filter(e=>e.event==='step').length>=3){this.suppressed++;return false;}
    // Creature voices cannot fill the general effects ceiling or steal the
    // final eight slots needed by movement, weapons and interaction feedback.
    const creatureSources=new Set([...this.entries.values()].map(e=>e.source).filter(Boolean));for(const source of this.retiring.keys())creatureSources.add(source);
    const generalVoices=audio.voices.size-[...creatureSources].filter(source=>audio.sourceVoices.has(source)).length;
    // A fading predecessor and its queued replacement share one future slot.
    if(this.entries.size>=this.maxVoices||generalVoices+this.entries.size>=Math.max(1,audio.maxVoices-8)){
      const lower=[...this.entries.values()].filter(e=>e.priority<priority).sort((a,b)=>a.priority-b.priority||a.started-b.started)[0];
      if(lower){const releasing=this.stop(lower,.018);if(releasing)transition=transition?Promise.all([transition,releasing]):releasing;}else{this.suppressed++;return false;}
    }
    const key=this.select(bank,keys),vocal=event!=='step'&&event!=='barrier',profile=enemyVoiceProfile(id,kind,this.seed);
    const playbackRate=vocal?(kind==='nova'?(event==='death'?1.18:1.25):1)*profile.pitch:1;
    const levelRms=vocal?(['attack','death'].includes(event)?.30:.26):undefined;
    const baseVolume=event==='step'?(kind==='zombie'?.26:.2):event==='barrier'?.3:event==='ambient'?.38:event==='spawn'?.42:event==='sprint'?.46:event==='death'?.62:kind==='dog'?.63:.58;
    const volume=baseVolume*(vocal?profile.level:1);
    const entry={slot,id,kind,event,key,priority,position:p,started:now,controller:new AbortController(),source:null,transition,playbackRate,voiceIdentity:profile.identity};
    this.acoustics(entry,true);
    this.entries.set(slot,entry);this.last.set(bank,key);this.cooldowns.set(cooldown,now+({step:.11,attack:.55,death:3,barrier:.7,teardown:2,behind:5}[event]??2));this.accepted++;
    if(event==='behind')this.behindAt=now+5;
    const play=()=>audio.native(key,volume,false,{position:entry.position,occlusion:entry.occlusion,signal:entry.controller.signal,playbackRate,levelRms,envelope:vocal,smoothMotion:true,shouldStart:()=>{
      // General effects can arrive while a recording decodes. Recheck here so
      // completing creature requests never evict weapon or movement feedback.
      if(audio.voices.size>=Math.max(1,audio.maxVoices-8)){this.suppressed++;return false;}return true;
    },event:{enemyId:id,enemyKind:kind,enemyEvent:event,playbackRate,...(vocal?{voiceIdentity:profile.identity,voicePitch:profile.pitch,voiceLevel:profile.level}:{}),occluded:entry.occlusion>0,...(event==='step'?{adaptation:'shared-native-surface-footfall',surface:surfaceFromMaterial(meta.surface)}:{})}});
    (transition?transition.then(play):play()).then(source=>{
      if(entry.controller.signal.aborted||this.entries.get(slot)!==entry){audio.stopSource(source);return;}
      entry.source=source;audio.moveSource(source,entry.position);audio.setSourceOcclusion(source,entry.occlusion);this.prune();
    }).catch(error=>{this.stop(entry);console.error(error);});
    return key;
  }
  snapshot(){this.prune();return {active:this.entries.size,maxVoices:this.maxVoices,footstepVoices:[...this.entries.values()].filter(e=>e.event==='step').length,accepted:this.accepted,suppressed:this.suppressed,occlusionChecks:this.occlusionChecks,retiringVoices:this.retiring.size,voiceSeed:this.seed,voices:[...this.entries.values()].map(e=>({id:e.id,kind:e.kind,event:e.event,key:e.key,pending:!e.source,playbackRate:e.playbackRate,voiceIdentity:e.voiceIdentity,occluded:e.occlusion>0,position:e.position.slice()}))};}
}
