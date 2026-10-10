// Leave room for the menu bar, Dock and the window frame on smaller laptops.
export function initialWindowSize(workArea={}) {
 const valid=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
 return {width:Math.max(720,Math.min(1440,Math.floor(valid(workArea.width,1440)-48))),
   height:Math.max(480,Math.min(900,Math.floor(valid(workArea.height,900)-48)))};
}
