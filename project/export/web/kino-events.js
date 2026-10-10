const ROOM_POWERUPS=['nuke','insta_kill','double_points','carpenter','fire_sale','full_ammo','minigun'];

// Reel selection follows zombie_theater_movie_screen.gsc; return-room drops
// follow maps/zombie_theater_teleporter.gsc:eeroom_powerup_drop in the supplied ZIP.
export class KinoEvents {
  constructor(data,random=Math.random){this.data=data;this.random=random;this.reset();}
  reset(){
    const groups=['clean_bedroom','bear_bedroom','interrogation','pentagon'];
    for(let i=groups.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
    this.reels=groups.slice(0,3).map((group,i)=>{const candidates=this.data.entities.filter(e=>e.targetname==='trigger_movie_reel_'+group);return {entity:candidates[Math.floor(this.random()*candidates.length)],film:i+1,collected:false};});
    this.carried=null;this.installed=new Set();this.film=0;this.room=null;this.roomUntil=0;this.roomPowerup=null;this.roomPowerupChoice=null;
  }
  available(id){return !this.carried&&this.reels.some(r=>r.entity.id===id&&!r.collected);}
  take(id){const reel=this.reels.find(r=>r.entity.id===id);if(!this.available(id))return false;reel.collected=true;this.carried=reel.film;return true;}
  install(){if(!this.carried)return false;this.film=this.carried;this.installed.add(this.carried);this.carried=null;return true;}
  chooseRoom(){
    this.roomPowerup=null;this.roomPowerupChoice=null;
    if(this.random()<.25)return null;
    const rooms=this.data.entities.filter(e=>/^ee_teleport_player[0-3]$/.test(e.targetname));
    if(!rooms.length)return null;
    const room=rooms[Math.floor(this.random()*rooms.length)];
    // RandomInt(100)>65 is 34%, despite the source's "30%" comment.
    // The source chooses among all authored markers, including unvisited rooms.
    if(Math.floor(this.random()*100)>65){
      const markers=this.data.entities.filter(e=>e.targetname==='struct_random_powerup_post_teleport');
      if(markers.length){
        const marker=markers[Math.floor(this.random()*markers.length)],type=ROOM_POWERUPS[Math.floor(this.random()*ROOM_POWERUPS.length)];
        this.roomPowerupChoice=type;
        // Death Machine has no recovered implementation. Preserve its outcome as
        // no drop, rather than increasing the other six types' probabilities.
        if(this.data.powerups?.[type])this.roomPowerup={type,markerId:marker.id,position:[...marker.position]};
      }
    }
    return room;
  }
  consumeRoomPowerup(){const drop=this.roomPowerup;this.roomPowerup=null;return drop;}
  snapshot(){return {reels:this.reels.map(r=>({id:r.entity.id,position:r.entity.position,film:r.film,collected:r.collected})),carried:this.carried,installed:[...this.installed],film:this.film,room:this.room?.targetname??null,roomUntil:this.roomUntil,roomPowerup:this.roomPowerup?{...this.roomPowerup,position:[...this.roomPowerup.position]}:null,roomPowerupChoice:this.roomPowerupChoice};}
}
