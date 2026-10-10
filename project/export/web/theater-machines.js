import * as THREE from 'three';
import {boxLocatorMatrix} from './box-locator.js';

// Reconnect authored machine props. Timing and purchases remain in game/session.
// Lamp tint substitutes for absent red/green cage variants; no new map light.
export class TheaterMachines {
  constructor({scene,world,data,clockTime=new Date()}){
    this.scene=scene;this.world=world;this.data=data;this.original=[];this.shades=[];
    this.clockSeconds=clockTime.getHours()*3600+clockTime.getMinutes()*60+clockTime.getSeconds();
    const find=name=>world.entities.get(data.entities.find(e=>e.targetname===name)?.id);
    this.cableOff=find('teleporter_link_cable_off');this.cableOn=find('teleporter_link_cable_on');
    this.hands={hour:find('zom_clock_hour_hand'),minute:find('zom_clock_minute_hand'),second:find('zom_clock_second_hand')};
    for(const object of [this.cableOff,this.cableOn,...Object.values(this.hands)].filter(Boolean))this.original.push({object,visible:object.visible,quaternion:object.quaternion.clone()});
    this.handRotations=Object.fromEntries(Object.entries(this.hands).filter(([,o])=>o).map(([name,o])=>[name,o.quaternion.clone()]));
    const indicator=find('teleporter_indicator_lights');this.indicator=indicator;
    if(indicator){
      this.original.push({object:indicator,visible:indicator.visible,quaternion:indicator.quaternion.clone()});
      indicator.quaternion.setFromRotationMatrix(boxLocatorMatrix(data.entities.find(e=>e.targetname==='teleporter_indicator_lights')));indicator.updateMatrixWorld(true);
    }
    indicator?.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const originals=[mesh.material].flat(),copies=originals.map(m=>{
        if(!/mtl_glass_v2_off|mtl_filament/.test(m.name))return m;
        const copy=m.clone();this.shades.push({copy,color:m.color.clone(),emissive:m.emissive?.clone(),intensity:m.emissiveIntensity});return copy;
      });
      if(copies.some((m,i)=>m!==originals[i])){this.original.push({mesh,material:mesh.material});mesh.material=Array.isArray(mesh.material)?copies:copies[0];}
    });
    // A small depth-tested filament, positioned inside the native lamp bounds.
    if(indicator){
      const center=new THREE.Box3().setFromObject(indicator).getCenter(new THREE.Vector3());
      this.glowGeometry=new THREE.BufferGeometry();this.glowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(center.toArray(),3));
      this.glowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
        uniforms:{color:{value:new THREE.Color()},amount:{value:0},pixelHeight:{value:900}},
        vertexShader:'uniform float pixelHeight;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(pixelHeight*6./max(1.,-p.z),1.,32.);}',
        fragmentShader:'uniform vec3 color;uniform float amount;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(color,pow(1.-r,1.6)*amount);}'
      });
      this.glow=new THREE.Points(this.glowGeometry,this.glowMaterial);this.glow.name='Teleporter cage filament';scene.add(this.glow);
    }
    this.rotation=new THREE.Quaternion();this.axis=new THREE.Vector3(0,0,1);this.reset();
  }
  update({time=0,power=false,teleporter='unlinked',teleportPending=0,returnAt=0,inReturnRoom=false,gameover=false,pixelHeight=900}={}){
    const ready=power&&teleporter==='linked'&&!teleportPending;
    const busy=!ready;
    // The native cable stays lit during the projection/return-room trip, then
    // switches off for the cooldown after the player arrives in the lobby.
    const linked=power&&!gameover&&(teleporter==='linked'||!!returnAt||inReturnRoom);
    if(this.cableOn)this.cableOn.visible=linked;if(this.cableOff)this.cableOff.visible=!linked;
    const color=new THREE.Color(power?(busy?0xd93624:0x5da340):0x27231c);
    for(const s of this.shades){s.copy.color.copy(power?color:s.color);if(s.copy.emissive){s.copy.emissive.copy(power?color:s.emissive??new THREE.Color(0));s.copy.emissiveIntensity=power?.65:s.intensity;}}
    if(this.glow){this.glow.visible=power&&!gameover;this.glowMaterial.uniforms.color.value.copy(color);this.glowMaterial.uniforms.amount.value=.6;this.glowMaterial.uniforms.pixelHeight.value=pixelHeight;}
    const seconds=this.clockSeconds+time;
    this.rotateHand('hour',(seconds%43200)/43200*Math.PI*2);
    this.rotateHand('minute',(seconds%3600)/3600*Math.PI*2);
    const remaining=returnAt?THREE.MathUtils.clamp(returnAt-time,0,30):0;
    // Native server clock starts at six and ticks half a revolution in 30s.
    const elapsed=30-remaining;
    const tick=returnAt?Math.min(30,Math.floor(elapsed)+Math.min(1,(elapsed%1)/.1)):0;
    this.rotateHand('second',returnAt?Math.PI+tick*Math.PI/30:0);
    this.state={power,teleporter,cableOn:!!this.cableOn?.visible,cableOff:!!this.cableOff?.visible,indicator:power?(busy?'red':'green'):'off',remaining,clockAngles:Object.fromEntries(Object.entries(this.hands).filter(([,o])=>o).map(([name,o])=>[name,o.rotation.z])),nativeHands:Object.values(this.hands).filter(Boolean).length,glowPoints:this.glow?1:0};
  }
  rotateHand(name,angle){const object=this.hands[name];if(object)object.quaternion.copy(this.handRotations[name]).multiply(this.rotation.setFromAxisAngle(this.axis,angle));}
  reset(){this.update();}
  snapshot(){return {...this.state,clockAngles:{...this.state.clockAngles}};}
  dispose(){
    for(const item of this.original){if(item.mesh)item.mesh.material=item.material;else{item.object.visible=item.visible;item.object.quaternion.copy(item.quaternion);}}
    for(const s of this.shades)s.copy.dispose();this.glow?.removeFromParent();this.glowGeometry?.dispose();this.glowMaterial?.dispose();
  }
}
