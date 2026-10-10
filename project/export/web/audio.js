// Native T5 cues decoded from IWD streams and resident LoadedSound records.
import { surfaceFromMaterial } from './audio-surfaces.js';
import { EnemyAudio } from './enemy-audio.js';
import {shotPrefix,dryFirePrefix,papShotKeys,usesPapShot,notifyKeys} from './weapon-audio.js';
const announcementCues=new Set(['dog_announce','full_ammo','insta_kill','double_points','nuke','carpenter','fire_sale']);
const stoppedSource=Object.freeze({stop(){},disconnect(){}});
const vector=v=>{const a=Array.isArray(v)?v:[v?.x,v?.y,v?.z];return a.length===3&&a.every(Number.isFinite)?a.slice():null;};
export class GameAudio {
  constructor(){this._enabled=true;this.ctx=null;this.manifest={};this.buffers=new Map();this.bufferSizes=new Map();this.bufferBytes=0;this.maxBufferBytes=Infinity;this.synthBuffers=new Map();this.recordingLevels=new WeakMap();this.preload=true;this.played=[];this.music=null;this.musicToken=0;this.variants=new Map();this.lastVariants=new Map();this.recentEvents=[];this.listenerState=null;this.mix={master:100,effects:100,music:100,ambience:100,dialogue:100};this.groups=null;this.maxVoices=48;this.maxMusicVoices=4;this.voices=new Set();this.musicVoices=new Set();this.sourceVoices=new WeakMap();this.pendingVoices=new Set();this.playbackToken=0;this.acceptPlayback=true;}
  async load(){const r=await fetch('audio/manifest.json');if(!r.ok)throw new Error('Audio manifest HTTP '+r.status);this.manifest=await r.json();}
  enemy(event,position,meta){this.enemyAudio??=new EnemyAudio(this);return this.enemyAudio.emit(event,position,meta);}
  setOcclusionTest(test){this.occlusionTest=typeof test==='function'?test:null;}
  occlusionAt(position){const p=vector(position);return p&&this.listenerState&&this.occlusionTest?.(this.listenerState.position,p)===false?1:0;}
  get enabled(){return this._enabled;}
  set enabled(v){this._enabled=v;this.applyMix();}
  setMix(values={}){
    for(const key of Object.keys(this.mix))if(typeof values[key]==='number'&&Number.isFinite(values[key]))this.mix[key]=Math.max(0,Math.min(100,values[key]));
    this.applyMix();return {...this.mix};
  }
  applyMix(){if(this.master)this.master.gain.value=this.enabled?.42*this.mix.master/100:0;if(this.groups)for(const [key,gain] of Object.entries(this.groups))gain.gain.value=this.mix[key]/100;}
  channel(key,loop=false){
    if(key==='ambience'||key.includes('/amb/')||key.endsWith('/underscore_l'))return 'ambience';
    if(key==='115'||key==='fire_sale_music'||key.includes('/mus/'))return 'music';
    if(announcementCues.has(key)||/\/(?:vox|dialog|dialogue|announcer)\//.test(key))return 'dialogue';
    return 'effects';
  }
  start(){this.paused=false;this.acceptPlayback=true;if(!this.ctx){const Context=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Context){this.enabled=false;return;}this.ctx=new Context();this.master=this.ctx.createGain();this.master.connect(this.ctx.destination);this.groups={};for(const key of ['effects','music','ambience','dialogue']){const gain=this.ctx.createGain();gain.connect(this.master);this.groups[key]=gain;}this.applyMix();
    if(this.preload)for(const key of Object.keys(this.manifest))if(key.startsWith('resident/evt/zombie_global/')||['nuke','full_ammo','insta_kill','double_points','carpenter','fire_sale','fire_sale_music'].includes(key)||key.startsWith('specialty_'))this.buffer(key).catch(console.error);
  }this.ctx.resume();if(this.listenerState)this.setListener(this.listenerState.position,this.listenerState.forward,this.listenerState.up);if(!this.music)this.playMusic('ambience').catch(console.error);}
  select(prefix){
    if(!this.variants.has(prefix))this.variants.set(prefix,Object.keys(this.manifest).filter(k=>k.startsWith(prefix)));
    const keys=this.variants.get(prefix);return keys[Math.floor(Math.random()*keys.length)];
  }
  selectWorld(prefix){
    if(!this.variants.has(prefix))this.variants.set(prefix,Object.keys(this.manifest).filter(k=>k.startsWith(prefix)));
    const keys=this.variants.get(prefix),last=this.lastVariants.get(prefix),choices=keys.length>1?keys.filter(k=>k!==last):keys;
    const key=choices[Math.floor(Math.random()*choices.length)];if(key)this.lastVariants.set(prefix,key);return key;
  }
  setListener(position,forward=[0,0,-1],up=[0,1,0]){
    const p=vector(position),f=vector(forward),u=vector(up);if(!p||!f||!u)return false;
    this.listenerState={position:p,forward:f,up:u};const listener=this.ctx?.listener;if(!listener)return true;
    if(listener.positionX){for(const [axis,i] of [['X',0],['Y',1],['Z',2]]){listener['position'+axis].value=p[i];listener['forward'+axis].value=f[i];listener['up'+axis].value=u[i];}}
    else{listener.setPosition?.(...p);listener.setOrientation?.(...f,...u);}return true;
  }
  output(gain,channel,options={}){
    const position=vector(options.position),destination=this.groups?.[channel]??this.master;
    if(!position||!this.ctx.createPanner){gain.connect(destination);return [];}
    const panner=this.ctx.createPanner();panner.panningModel='HRTF';panner.distanceModel='linear';panner.refDistance=80;panner.maxDistance=1400;panner.rolloffFactor=1;
    if(panner.positionX){panner.positionX.value=position[0];panner.positionY.value=position[1];panner.positionZ.value=position[2];}else panner.setPosition?.(...position);
    const spatial=[panner];
    // Only callers requesting occlusion gain/filter the dry signal. Existing
    // player weapons, interface cues and other maps retain their original mix.
    if(Number.isFinite(options.occlusion)&&this.ctx.createBiquadFilter){
      const filter=this.ctx.createBiquadFilter(),muffle=this.ctx.createGain(),value=Math.max(0,Math.min(1,options.occlusion));
      filter.type='lowpass';filter.frequency.value=18000*Math.pow(850/18000,value);filter.Q&&(filter.Q.value=.7);muffle.gain.value=1-.65*value;
      gain.connect(filter);filter.connect(muffle);muffle.connect(panner);spatial.push(filter,muffle);spatial.occlusion={filter,gain:muffle,value};
    }else gain.connect(panner);
    panner.connect(destination);return spatial;
  }
  recordEvent(key,channel,position,native,details={}){this.recentEvents.push({key,channel,position:vector(position),native,time:this.ctx?.currentTime??0,...details});if(this.recentEvents.length>30)this.recentEvents.shift();}
  playAt(kind,position,volume=1){return this.play(kind,volume,{position:vector(position)});}
  movement(kind,{surface='concrete',sprint=false,volume=1}={}){
    const material=surfaceFromMaterial(surface),gaits=kind==='land'?['land']:sprint?['sprint','run','walk']:['walk','run'];
    let key;for(const gait of gaits){key=this.selectWorld('shared/fly/footsteps/'+gait+'/'+material+'/');if(key)break;}
    if(!key)key=this.selectWorld('shared/fly/footsteps/'+(kind==='land'?'land':'walk')+'/concrete/');
    this.play(key??(kind==='land'?'land':'step'),volume);return key??null;
  }
  impact(kind,position,volume=1){
    const prefix={'zombie-head':'shared/fly/gibs/zombie/head/','zombie-electric':'shared/fly/gibs/zombie/elec/',grenade:'shared/wpn/grenade/explosion/explode/',raygun:'shared/wpn/energy/raygun/projectile/impact/',thundergun:'shared/wpn/energy/thundergun/projectile/impact/'}[kind];
    const key=prefix&&this.selectWorld(prefix);this.playAt(key??(kind==='bullet'?'impact':'explosion'),position,volume);return key??null;
  }
  trapLoop(type,position,volume=.3){
    if(!this.ctx||!this.acceptPlayback)return stoppedSource;
    const kind=type==='fire'?'fire':'electric',key='trap/'+kind,c=this.ctx;
    if(!this.synthBuffers.has(kind)){
      const length=Math.ceil(c.sampleRate*2),buffer=c.createBuffer(1,length,c.sampleRate),samples=buffer.getChannelData(0);let rumble=0,crackle=0;
      for(let i=0;i<length;i++){
        const t=i/c.sampleRate,noise=Math.random()*2-1;rumble=rumble*.985+noise*.09;crackle=Math.random()>.996?noise:crackle*.86;
        const signal=kind==='fire'?rumble*.6+crackle*.4+noise*.08:Math.sin(t*Math.PI*120)*.4+Math.sin(t*Math.PI*240)*.15+noise*(.2+.12*Math.sin(t*Math.PI*34));
        samples[i]=Math.max(-1,Math.min(1,signal))*Math.min(1,i/(c.sampleRate*.008),(length-1-i)/(c.sampleRate*.008));
      }this.synthBuffers.set(kind,buffer);
    }
    const source=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();source.buffer=this.synthBuffers.get(kind);source.loop=true;filter.type='lowpass';filter.frequency.value=kind==='fire'?2200:2600;gain.gain.value=(Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):.3)*.45;
    source.connect(filter);filter.connect(gain);const spatial=this.output(gain,'effects',{position:vector(position)}),voice=this.trackVoice(source,[source,filter,gain,...spatial],key,'effects');voice.spatial=spatial.length>0;
    try{source.start();}catch(error){voice.stop();throw error;}this.recordEvent(key,'effects',position,false);
    return {stop:()=>this.stopSource(source),disconnect:()=>this.stopSource(source)};
  }
  warmWeapon(def,notifies=[]){
    if(!this.ctx)return;
    const prefix=shotPrefix(def),dry=dryFirePrefix(def),needed=new Set(notifies.flatMap(name=>notifyKeys(this.manifest,name,def)));
    if(usesPapShot(def))for(const key of papShotKeys)needed.add(key);
    for(const key of Object.keys(this.manifest))if(prefix&&key.startsWith(prefix)||dry&&key.startsWith(dry)||key.includes('/melee/knife/')||key.includes('/bowie/')||needed.has(key))this.buffer(key).catch(()=>{});
  }
  weapon(kind,def,position=null,options={}){
    const prefix=kind==='shot'?shotPrefix(def):kind==='empty'?dryFirePrefix(def):null;
    let cue=prefix&&this.selectWorld(prefix);
    if(kind==='shot'&&def.id==='thundergun_zm'&&options.lastShot&&this.manifest['resident/wpn/energy/thundergun/plr/shot/wpn_thundergun_fire_last_plr'])cue='resident/wpn/energy/thundergun/plr/shot/wpn_thundergun_fire_last_plr';
    if(position)this.playAt(cue??kind,position,kind==='shot'?.75:1);else this.play(cue??kind,kind==='shot'?.75:1);
    if(kind==='shot'&&usesPapShot(def))for(const [i,key]of papShotKeys.entries())if(this.manifest[key]){
      const level=i===0?.36:.1;
      if(position)this.playAt(key,position,level);else this.play(key,level);
    }
    return cue??null;
  }
  knife(kind,bowie=false){
    const prefix=bowie?(kind==='swing'?'bowie/bowie_swing/':'bowie/bowie_stab/'):
      'melee/knife/'+({swing:'knife_whoosh/',hit:'knife_stab/',wall:'hit_object/',pull:'knife_pull/'}[kind]);
    const key=this.select('resident/wpn/'+(kind==='wall'?'melee/knife/hit_object/':prefix));
    if(key)this.play(key,.9);
  }
  notifyKey(name,def){return notifyKeys(this.manifest,name,def)[0];}
  notify(name,def){
    const keys=notifyKeys(this.manifest,name,def);if(!keys.length)return;
    const bank='notify:'+name,last=this.lastVariants.get(bank),choices=keys.length>1?keys.filter(k=>k!==last):keys,key=choices[Math.floor(Math.random()*choices.length)];
    this.lastVariants.set(bank,key);this.play(key,.65);return key;
  }
  event(path,volume=1,position=null){if(position)this.playAt('resident/evt/zombie_global/'+path,position,volume);else this.play('resident/evt/zombie_global/'+path,volume);}
  fireSale(on){
    if(this.saleOn===on)return;this.saleOn=on;const token=this.saleToken=(this.saleToken??0)+1;
    this.stopSource(this.saleMusic);this.saleMusic=null;
    if(on&&this.ctx&&this.acceptPlayback)this.native('fire_sale_music',.35,true).then(source=>{if(token!==this.saleToken)this.stopSource(source);else this.saleMusic=source;}).catch(console.error);
  }
  pause(){this.paused=true;return this.ctx?.suspend();}
  reset(){
    this.enemyAudio?.reset();
    this.acceptPlayback=false;this.playbackToken++;this.musicToken++;this.saleToken=(this.saleToken??0)+1;this.pendingVoices.clear();
    this.stopSource(this.music);this.stopSource(this.saleMusic);
    for(const voice of [...this.voices,...this.musicVoices])voice.stop();
    this.music=null;this.saleMusic=null;this.saleOn=false;this.played=[];this.recentEvents=[];this.lastVariants.clear();
    return this.pause();
  }
  trackVoice(source,nodes,key,channel,separate=false){
    const voices=separate?this.musicVoices:this.voices,limit=separate?this.maxMusicVoices:this.maxVoices;
    while(voices.size>=Math.max(1,limit))voices.values().next().value.stop();
    let cleaned=false;
    const cleanup=()=>{
      if(cleaned)return;cleaned=true;voices.delete(voice);this.sourceVoices.delete(source);
      for(const node of nodes)try{node.disconnect();}catch{}
      source.onended=null;voice.resolveRelease?.();
      if(this.music===source)this.music=null;if(this.saleMusic===source)this.saleMusic=null;
    };
    const voice={source,key,channel,cleanup,stop(){try{source.stop();}catch{}cleanup();}};
    voice.release=seconds=>{
      if(cleaned)return Promise.resolve();if(voice.releasePromise)return voice.releasePromise;
      const param=voice.gain?.gain;if(!param?.linearRampToValueAtTime){voice.stop();return Promise.resolve();}
      const now=this.ctx.currentTime,duration=Math.max(.004,Math.min(.04,seconds));
      voice.releasePromise=new Promise(resolve=>voice.resolveRelease=resolve);
      if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(now);else{param.cancelScheduledValues?.(now);param.setValueAtTime(param.value,now);}
      param.linearRampToValueAtTime(0,now+duration);try{source.stop(now+duration);}catch{voice.stop();}return voice.releasePromise;
    };
    source.onended=cleanup;voices.add(voice);this.sourceVoices.set(source,voice);return voice;
  }
  stopSource(source,fadeSeconds=0){
    if(!source)return Promise.resolve();const voice=this.sourceVoices.get(source);
    if(voice){if(fadeSeconds>0)return voice.release(fadeSeconds);voice.stop();}else try{source.stop();}catch{}
    return Promise.resolve();
  }
  moveSource(source,position){const voice=source&&this.sourceVoices.get(source),p=vector(position);if(!voice||!p)return;for(const node of voice.spatialNodes??[]){if(node.positionX){for(const [axis,i]of [['X',0],['Y',1],['Z',2]]){const param=node['position'+axis];if(voice.smoothMotion&&param.setTargetAtTime)param.setTargetAtTime(p[i],this.ctx.currentTime,.035);else param.value=p[i];}}else node.setPosition?.(...p);}}
  setSourceOcclusion(source,amount){
    const state=source&&this.sourceVoices.get(source)?.occlusion;if(!state||!Number.isFinite(amount))return;
    const value=Math.max(0,Math.min(1,amount));if(value===state.value)return;state.value=value;
    for(const [param,target] of [[state.filter.frequency,18000*Math.pow(850/18000,value)],[state.gain.gain,1-.65*value]]){
      if(param.setTargetAtTime)param.setTargetAtTime(target,this.ctx.currentTime,.06);else param.value=target;
    }
  }
  async buffer(key){
    if(this.buffers.has(key)){const cached=this.buffers.get(key);this.buffers.delete(key);this.buffers.set(key,cached);return cached;}
    const pending=fetch(this.manifest[key].url).then(r=>{if(!r.ok)throw new Error('Audio '+key+' HTTP '+r.status);return r.arrayBuffer();}).then(b=>this.ctx.decodeAudioData(b)).then(buffer=>{
      const bytes=buffer.length*buffer.numberOfChannels*4;this.bufferSizes.set(key,bytes);this.bufferBytes+=bytes;
      for(const oldest of this.buffers.keys()){
        if(this.bufferBytes<=this.maxBufferBytes)break;
        const size=this.bufferSizes.get(oldest);if(size==null)continue;
        this.buffers.delete(oldest);this.bufferSizes.delete(oldest);this.bufferBytes-=size;
      }
      return buffer;
    }).catch(error=>{this.buffers.delete(key);throw error;});
    this.buffers.set(key,pending);return pending;
  }
  recordingGain(buffer,targetRms){
    if(!Number.isFinite(targetRms)||targetRms<=0||!buffer.getChannelData)return 1;
    let rms=this.recordingLevels.get(buffer);
    if(rms===undefined){let sum=0;for(let c=0;c<buffer.numberOfChannels;c++)for(const value of buffer.getChannelData(c))sum+=value*value;rms=Math.sqrt(sum/(buffer.length*buffer.numberOfChannels));this.recordingLevels.set(buffer,rms);}
    return rms>0?Math.min(1,targetRms/rms):1;
  }
  async native(key,volume=1,loop=false,options={}){
    if(!this.ctx||!this.acceptPlayback||options.signal?.aborted)return stoppedSource;
    const request={token:this.playbackToken};this.pendingVoices.add(request);
    try{
      const b=await this.buffer(key);
      if(request.token!==this.playbackToken||!this.acceptPlayback||options.signal?.aborted||options.shouldStart?.()===false)return stoppedSource;
      const source=this.ctx.createBufferSource(),gain=this.ctx.createGain(),channel=this.channel(key,loop);
      source.buffer=b;source.loop=loop;if(source.playbackRate&&Number.isFinite(options.playbackRate))source.playbackRate.value=Math.max(.65,Math.min(1.6,options.playbackRate));const levelGain=this.recordingGain(b,options.levelRms);gain.gain.value=volume*levelGain;
      if(options.envelope&&!loop&&gain.gain.linearRampToValueAtTime){
        const now=this.ctx.currentTime,length=(b.duration??b.length/this.ctx.sampleRate)/(source.playbackRate?.value||1),attack=Math.min(.006,length/4),release=Math.min(.012,length/4);
        gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(volume*levelGain,now+attack);gain.gain.setValueAtTime(volume*levelGain,now+length-release);gain.gain.linearRampToValueAtTime(0,now+length);
      }
      source.connect(gain);const spatial=this.output(gain,channel,options);
      const voice=this.trackVoice(source,[source,gain,...spatial],key,channel,loop||channel==='music'||channel==='ambience');voice.spatial=spatial.length>0;voice.spatialNodes=spatial.length?[spatial[0]]:[];voice.occlusion=spatial.occlusion;voice.gain=gain;voice.smoothMotion=!!options.smoothMotion;
      try{source.start();}catch(error){voice.stop();throw error;}
      this.played.push(key);if(this.played.length>30)this.played.shift();this.recordEvent(key,channel,options.position,this.manifest[key]?.native!==false,{sourceType:this.manifest[key]?.sourceType??'native-recording',...(Number.isFinite(options.levelRms)?{levelGain}:{}),...options.event});return source;
    }finally{this.pendingVoices.delete(request);}
  }
  async playMusic(key){
    if(!this.ctx||!this.acceptPlayback)return;
    const token=++this.musicToken,lifecycle=this.playbackToken;this.stopSource(this.music);this.music=stoppedSource;
    try{
      const music=await this.native(key,key==='ambience'?.18:.65,key==='ambience');
      if(token!==this.musicToken||lifecycle!==this.playbackToken){this.stopSource(music);return;}
      this.music=music;
    }catch(error){if(token===this.musicToken)this.music=null;throw error;}
  }
  play(kind,volume=1,options={}){
    if(!this.enabled||!this.ctx||this.paused||!this.acceptPlayback)return;
    if(this.manifest[kind]){this.native(kind,volume*.8,false,options).catch(console.error);return;}
    const c=this.ctx,t=c.currentTime,g=c.createGain(),channel=this.channel(kind),spatial=this.output(g,channel,options);g.gain.setValueAtTime(Math.max(.001,volume*.25),t);
    const duration={step:.12,land:.18,shot:.18,knife:.16,hit:.08,impact:.07,board:.18,reload:.11,growl:.75,round:1.5,buy:.35,empty:.06,explosion:.9}[kind]??.25;
    g.gain.exponentialRampToValueAtTime(.001,t+duration);
    this.recordEvent(kind,channel,options.position,false);
    if(['step','land','shot','knife','hit','impact','board','reload','growl','explosion'].includes(kind)){
      const buffer=c.createBuffer(1,Math.ceil(c.sampleRate*duration),c.sampleRate),a=buffer.getChannelData(0);
      for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1);
      const src=c.createBufferSource(),filter=c.createBiquadFilter();src.buffer=buffer;filter.type='lowpass';filter.frequency.value=kind==='growl'?180:kind==='step'?450:kind==='land'?250:kind==='shot'?3500:kind==='impact'?3800:kind==='explosion'?400:1600;src.connect(filter);filter.connect(g);const voice=this.trackVoice(src,[src,filter,g,...spatial],kind,channel);voice.spatial=spatial.length>0;src.start();src.stop(t+duration);
    }else{const o=c.createOscillator();o.type=kind==='round'?'sawtooth':'sine';o.frequency.setValueAtTime(kind==='round'?62:kind==='buy'?660:180,t);o.frequency.exponentialRampToValueAtTime(kind==='round'?38:kind==='buy'?990:60,t+duration);o.connect(g);const voice=this.trackVoice(o,[o,g,...spatial],kind,channel);voice.spatial=spatial.length>0;o.start();o.stop(t+duration);}
  }
  snapshot(){const enemy=this.enemyAudio?.snapshot()??{active:0,maxVoices:10,accepted:0,suppressed:0,voices:[]};const byChannel={effects:0,music:0,ambience:0,dialogue:0};for(const voice of [...this.voices,...this.musicVoices])byChannel[voice.channel]++;return {enemy,enabled:this.enabled,mix:{...this.mix},nativeCues:Object.values(this.manifest).filter(m=>m.native!==false).length,communityCues:Object.values(this.manifest).filter(m=>m.native===false).length,recordedCues:Object.keys(this.manifest).length,decoded:this.buffers.size,decodedBytes:this.bufferBytes,syntheticBufferBytes:[...this.synthBuffers.values()].reduce((bytes,b)=>bytes+b.length*b.numberOfChannels*4,0),played:this.played.slice(),state:this.ctx?.state??'idle',voices:this.voices.size,musicVoices:this.musicVoices.size,pendingVoices:this.pendingVoices.size,maxVoices:this.maxVoices,voicesByChannel:byChannel,spatialVoices:[...this.voices].filter(v=>v.spatial).length,recentEvents:this.recentEvents.map(e=>({...e,position:e.position?.slice()??null}))};}
}
