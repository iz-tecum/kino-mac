import {displaySettings,GRAPHICS_PRESETS} from './display-performance.js';
const KEY='kino.desktop.settings.v1';
export const DEFAULT_SETTINGS=Object.freeze({version:1,sensitivity:1,aimSensitivity:1,invertLook:false,fov:78,quality:'balanced',brightness:2.05,reducedFlashes:false,weaponBob:true,textSize:100,crouchMode:'hold',sprintMode:'hold',wheelSwitch:true,master:80,effects:100,music:65,ambience:70,dialogue:100,profile:'classic'});
const ranges={sensitivity:[.25,2.5],aimSensitivity:[.25,2],fov:[65,105],brightness:[1.3,2.7],master:[0,100],effects:[0,100],music:[0,100],ambience:[0,100],dialogue:[0,100]};
export function validateSettings(raw){
  const result={...DEFAULT_SETTINGS};
  if(!raw||typeof raw!=='object'||raw.version!==1)return result;
  for(const [key,[min,max]]of Object.entries(ranges))if(typeof raw[key]==='number'&&Number.isFinite(raw[key]))result[key]=Math.max(min,Math.min(max,raw[key]));
  for(const key of ['invertLook','reducedFlashes','weaponBob','wheelSwitch'])if(typeof raw[key]==='boolean')result[key]=raw[key];
  for(const key of ['crouchMode','sprintMode'])if(['hold','toggle'].includes(raw[key]))result[key]=raw[key];
  if([100,120,140].includes(raw.textSize))result.textSize=raw.textSize;
  if(Object.hasOwn(GRAPHICS_PRESETS,raw.quality))result.quality=raw.quality;
  if(['classic','reimagined'].includes(raw.profile))result.profile=raw.profile;
  return result;
}
export function loadSettings(storage){try{return validateSettings(JSON.parse((storage??globalThis.localStorage).getItem(KEY)));}catch{return {...DEFAULT_SETTINGS};}}
export function saveSettings(value,storage){try{(storage??globalThis.localStorage).setItem(KEY,JSON.stringify(validateSettings(value)));}catch{}}
export function qualitySettings(name,display){return displaySettings(name,display);}
export function comfortSettings(settings){return validateSettings({...settings,reducedFlashes:true,weaponBob:false,textSize:Math.max(settings.textSize??100,120)});}
export function mountSettings(settings,onChange){
  const host=document.createElement('div');host.className='desktop-options';
  host.innerHTML=`<button class="secondary" id="settings-open" type="button" aria-expanded="false" aria-controls="settings-panel">Settings <span aria-hidden="true">＋</span></button>
  <section id="settings-panel" hidden role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="settings-heading"><h2 id="settings-title">Settings</h2><button type="button" id="settings-close" aria-label="Close settings">×</button></div>
  <div class="comfort-row"><div><strong>Less motion, easier reading</strong><p>Reduce flashes, steady the weapon and enlarge text.</p></div><button type="button" id="settings-comfort">Use comfort settings</button></div>
  <div class="settings-columns"><fieldset><legend>LOOK & MOVEMENT</legend>
  <label>Mouse sensitivity<input data-setting="sensitivity" type="range" min=".25" max="2.5" step=".05"><output></output></label>
  <label>Aim sensitivity<input data-setting="aimSensitivity" type="range" min=".25" max="2" step=".05"><output></output></label>
  <label>Field of view<input data-setting="fov" type="range" min="65" max="105" step="1"><output></output></label>
  <label class="check"><input data-setting="invertLook" type="checkbox">Invert vertical look</label>
  <label class="check"><input data-setting="weaponBob" type="checkbox">Weapon movement while walking</label>
  <label class="check"><input data-setting="reducedFlashes" type="checkbox">Reduce flashes</label>
  <label>Crouch<select data-setting="crouchMode"><option value="hold">Hold key</option><option value="toggle">Press to toggle</option></select></label>
  <label>Sprint<select data-setting="sprintMode"><option value="hold">Hold key</option><option value="toggle">Press to toggle</option></select></label>
  <label class="check"><input data-setting="wheelSwitch" type="checkbox">Scroll to switch weapons</label>
  </fieldset><fieldset><legend>PICTURE & SOUND</legend>
  <label>Graphics<select data-setting="quality" aria-describedby="graphics-note"><option value="laptop">Laptop · lighter graphics</option><option value="performance">Performance</option><option value="balanced">Balanced</option><option value="quality">Quality · sharper picture</option></select></label>
  <p id="graphics-note" class="settings-note">Laptop uses fewer effects and a softer picture. Picture detail adjusts automatically to keep larger screens manageable.</p>
  <label>Text size<select data-setting="textSize"><option value="100">Standard</option><option value="120">Large</option><option value="140">Larger</option></select></label>
  <label>Brightness<input data-setting="brightness" type="range" min="1.3" max="2.7" step=".05"><output></output></label>
  ${['master','effects','music','ambience','dialogue'].map(key=>`<label>${key==='dialogue'?'Announcements':key[0].toUpperCase()+key.slice(1)}<input data-setting="${key}" type="range" min="0" max="100" step="1"><output></output></label>`).join('')}
  </fieldset></div>
  <label class="profile-label">Next run<select data-setting="profile"><option value="classic">Classic reconstruction</option><option value="reimagined">Reimagined recovery</option></select></label><p class="settings-note">Classic keeps the reconstruction’s rules. Reimagined recovery uses faster health recovery from your BO1 mod; it is not the complete Reimagined ruleset. Applies when starting a new game.</p>
  <p class="settings-controls">WASD move · Shift sprint · Space jump · C / Ctrl crouch<br>Left mouse / Z fire · Q toggle aim · Hold right mouse to aim · R reload · F / E use or hold to repair<br>V knife · G grenade · 1 / 2 switch weapon · 4 claymore · X monkey<br>5 alternate attachment · M mute · Esc pause · ⌃⌘F fullscreen</p>
  <div class="settings-actions"><button type="button" id="settings-defaults">Restore defaults</button><button type="button" id="settings-done">DONE</button></div></section>`;
  document.querySelector('#menu .menu-content').append(host);
  const panel=host.querySelector('#settings-panel'),open=host.querySelector('#settings-open');
  let previousFocus=null,inert=[];
  const show=value=>{
    if(value===!panel.hidden)return;
    panel.hidden=!value;open.setAttribute('aria-expanded',String(value));document.getElementById('menu').classList.toggle('settings-visible',value);
    if(value){
      previousFocus=document.activeElement;
      inert=[...host.parentElement.children].filter(el=>el!==host).concat(open).map(el=>({el,was:el.inert}));
      for(const {el}of inert)el.inert=true;
      host.querySelector('#settings-close').focus();
    }else{
      for(const {el,was}of inert)el.inert=was;inert=[];
      (previousFocus?.isConnected?previousFocus:open).focus();
    }
  };
  open.onclick=()=>show(panel.hidden);host.querySelector('#settings-close').onclick=host.querySelector('#settings-done').onclick=()=>show(false);
  document.addEventListener('keydown',event=>{
    if(panel.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();show(false);return;}
    if(event.key!=='Tab')return;
    const items=[...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  },true);
  function refresh(){
    document.documentElement.style.setProperty('--ui-scale',settings.textSize/100);document.documentElement.dataset.uiText=String(settings.textSize);
    for(const input of host.querySelectorAll('[data-setting]')){const key=input.dataset.setting;if(input.type==='checkbox')input.checked=settings[key];else input.value=settings[key];const output=input.parentElement.querySelector('output');if(output)output.textContent=key==='fov'?Math.round(settings[key])+'°':ranges[key]?.[1]===100?Math.round(settings[key])+'%':settings[key].toFixed(2)+'×';}
  }
  for(const input of host.querySelectorAll('[data-setting]'))input.addEventListener('input',()=>{const key=input.dataset.setting;settings[key]=input.type==='checkbox'?input.checked:input.type==='range'||key==='textSize'?Number(input.value):input.value;saveSettings(settings);refresh();onChange(settings);});
  host.querySelector('#settings-comfort').onclick=()=>{Object.assign(settings,comfortSettings(settings));saveSettings(settings);refresh();onChange(settings);};
  host.querySelector('#settings-defaults').onclick=()=>{Object.assign(settings,DEFAULT_SETTINGS);saveSettings(settings);refresh();onChange(settings);};
  refresh();return {close:()=>show(false),isOpen:()=>!panel.hidden};
}
