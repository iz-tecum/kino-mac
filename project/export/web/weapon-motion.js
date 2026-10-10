// Secondary presentation only. Native XAnim poses and the gameplay camera keep
// ownership of sights, recoil direction, shot timing and weapon-part sockets.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
export class WeaponMotion {
  constructor(){this.reset();}
  reset(){this.phase=0;this.weight=0;this.kick=0;this.kickVelocity=0;this.offset=[0,0,0];this.rotation=[0,0,0];}
  fire(){this.kick=Math.min(.35,this.kick+.25);this.kickVelocity=0;}
  update(dt,{speed=0,grounded=true,aim=0,enabled=true}={}){
    dt=Math.max(0,finite(dt));speed=clamp(finite(speed),0,380);aim=clamp(finite(aim),0,1);
    if(dt>0){
      // Accumulate travelled cadence, not global time: changing speed never
      // teleports the bob phase. Actual movement suppresses it against a wall.
      this.phase=(this.phase+speed/190*9*dt)%(Math.PI*2);
      const target=grounded&&enabled?Math.min(speed/190,1.5):0;
      this.weight=target+(this.weight-target)*Math.exp(-14*dt);
      // Exact critically damped return is stable at 30, 60 or 144 Hz and has
      // no hard cutoff at the old 125 ms recoil boundary.
      const rate=32,decay=Math.exp(-rate*dt),term=this.kickVelocity+rate*this.kick;
      this.kick=(this.kick+term*dt)*decay;
      this.kickVelocity=(this.kickVelocity-rate*term*dt)*decay;
    }
    const amplitude=enabled?.13*this.weight*(1-aim)**2:0;
    this.offset[0]=Math.sin(this.phase)*amplitude;
    this.offset[1]=Math.cos(2*this.phase)*amplitude*.7;
    this.offset[2]=this.kick*(1-.55*aim);
    this.rotation[0]=this.kick*.048*(1-.55*aim);
    return this;
  }
  snapshot(){return {phase:this.phase,weight:this.weight,kick:this.kick,offset:[...this.offset],rotation:[...this.rotation]};}
}
