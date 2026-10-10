// Keyboard toggle, held mouse and touch aim are independent input sources.
// Native weapon/action rules still decide whether sights can be raised.
export class AimInput {
  constructor(){this.clear();}
  clear(){this.keyboardToggled=false;this.mouseHeld=false;this.keyHeld=false;}
  press({repeat=false,allowed=true}={}){
    if(!allowed||repeat||this.keyHeld)return false;
    this.keyHeld=true;this.keyboardToggled=!this.keyboardToggled;return true;
  }
  release(){this.keyHeld=false;}
  setMouse(held){this.mouseHeld=!!held;}
  read(touchAim=false){return this.keyboardToggled||this.mouseHeld||!!touchAim;}
  snapshot(){return {keyboardToggled:this.keyboardToggled,mouseHeld:this.mouseHeld};}
}
