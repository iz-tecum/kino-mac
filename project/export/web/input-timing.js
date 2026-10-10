// Browser timestamps stay separate from paused gameplay time.
export class FramePacer {
  constructor(){this.reset();}
  reset(){this.deadline=null;this.previous=null;this.interval=null;}
  sample(now,fps){
    if(!Number.isFinite(now)||!Number.isFinite(fps)||fps<=0)return null;
    const interval=1000/fps;
    if(this.interval!==interval){this.interval=interval;this.deadline=now;}
    // Native 60 Hz callbacks can arrive about 1 ms early and compensate on
    // the next tick. Accept that jitter without shifting the deadline grid;
    // otherwise a slightly early callback becomes a whole skipped frame.
    const tolerance=Math.min(1.25,interval/4);
    if(now+tolerance<this.deadline)return null;
    const elapsed=this.previous===null?0:Math.max(0,(now-this.previous)/1000);
    this.previous=now;
    // Preserve fractional refresh periods (e.g. 60 FPS on a 144 Hz display).
    // A stall discards missed renders; there is never a catch-up render burst.
    this.deadline=now-this.deadline>interval*3?now+interval:
      this.deadline+Math.max(1,Math.floor((now-this.deadline)/interval+1e-7)+1)*interval;
    return {elapsed,dt:Math.min(elapsed,.06)};
  }
}

export class WheelIntent {
  constructor(){this.reset();}
  reset(){this.last=-Infinity;this.total=0;this.direction=0;this.used=false;}
  consume(event,now){
    if(event.ctrlKey||event.metaKey||!Number.isFinite(event.deltaY)||!Number.isFinite(now)||Math.abs(event.deltaX??0)>Math.abs(event.deltaY)||event.deltaY===0)return false;
    const direction=Math.sign(event.deltaY);
    if(now-this.last>180||direction!==this.direction){this.total=0;this.used=false;}
    this.last=now;this.direction=direction;
    const delta=event.deltaY*(event.deltaMode===1?40:event.deltaMode===2?120:1);
    this.total+=Math.abs(delta);
    if(this.used||this.total<35)return false;
    this.used=true;return true;
  }
}

export function reloadPresentation(session){
  if(session.weaponUnavailable||session.reloadLeft<=0)return null;
  const segmented=!!session.def.segmentedReload,stage=session.reloadStage;
  return {progress:Math.max(0,Math.min(1,1-session.reloadLeft/Math.max(.001,session.reloadDuration))),
    label:segmented&&stage==='shell'?'LOADING SHELL':segmented&&stage==='end'?'READYING':'RELOADING',
    detail:segmented?`${session.weapon.mag} / ${session.def.clipSize}`:''};
}
