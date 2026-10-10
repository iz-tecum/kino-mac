// Limit real render pixels, independently of the OS's Retina scaling or GPU
// label. CSS text stays at display resolution. No fluctuating quality heuristic.
export const GRAPHICS_PRESETS=Object.freeze({
  laptop:Object.freeze({ratio:1,fps:60,sceneQuality:'performance',maxPixels:1250000}),
  performance:Object.freeze({ratio:1,fps:60,sceneQuality:'performance',maxPixels:1500000}),
  balanced:Object.freeze({ratio:1.25,fps:60,sceneQuality:'balanced',maxPixels:2100000}),
  quality:Object.freeze({ratio:1.5,fps:120,sceneQuality:'quality',maxPixels:3750000}),
});

export function displaySettings(name,display){
  const preset=Object.hasOwn(GRAPHICS_PRESETS,name)?GRAPHICS_PRESETS[name]:GRAPHICS_PRESETS.balanced;
  if(!display)return {...preset};
  const positive=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
  const width=Math.min(32768,positive(display.width,1440)),height=Math.min(32768,positive(display.height,900));
  const dpr=positive(display.devicePixelRatio,1);
  const maxPixels=display.mobile?Math.min(preset.maxPixels,1000000):preset.maxPixels;
  // A floor of 1 would defeat the budget on large/scaled displays. The canvas
  // may render below CSS resolution; the menu and HUD are still native text.
  const ratio=Math.min(dpr,display.mobile?1:preset.ratio,Math.sqrt(maxPixels/(width*height)));
  return {...preset,maxPixels,ratio,fps:display.mobile?30:preset.fps};
}
