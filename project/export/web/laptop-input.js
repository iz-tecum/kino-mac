// Keyboard alternatives share gameplay state with the mouse; menus never own
// held game actions. Toggle movement is cleared on pause, transport and downing.
export class LaptopInput {
  constructor(){this.clear();}
  clear(){this.fire=false;this.crouch=false;this.sprint=false;this.wasMoving=false;}
  press(code,{repeat=false,settings={}}={}){
    if(repeat)return false;
    if(code==='KeyZ'){const edge=!this.fire;this.fire=true;return edge;}
    if(code==='KeyC'&&settings.crouchMode==='toggle')this.crouch=!this.crouch;
    if((code==='ShiftLeft'||code==='ShiftRight')&&settings.sprintMode==='toggle')this.sprint=!this.sprint;
    return false;
  }
  release(code){if(code==='KeyZ')this.fire=false;}
  read(keys,settings={}){
    const forward=keys.has('KeyW')&&!keys.has('KeyS');
    if(this.wasMoving&&!forward)this.sprint=false;
    this.wasMoving=forward;
    return {fire:this.fire,
      crouch:(settings.crouchMode==='toggle'?this.crouch:keys.has('KeyC'))||keys.has('ControlLeft')||keys.has('ControlRight'),
      sprint:forward&&(settings.sprintMode==='toggle'?this.sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'))};
  }
  snapshot(){return {fire:this.fire,crouchToggled:this.crouch,sprintToggled:this.sprint};}
}
export function acceptsGameKey(event,active){
  return !!active&&!event.metaKey&&!event.altKey&&!event.isComposing&&
    !event.target?.closest?.('input,select,textarea,button,[contenteditable="true"]');
}
