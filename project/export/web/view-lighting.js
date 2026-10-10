import * as THREE from 'three';

// First-person hands retain a readable exposure floor, with restrained room
// colour and sun response. This approximates bounce, not native T5 light probes.
export class ViewLighting {
  constructor(ambient,key){
    this.ambient=ambient;this.key=key;this.baseAmbient=ambient.color.clone();this.baseKey=key.color.clone();
    this.basePosition=key.position.clone();this.targetPosition=new THREE.Vector3();this.localSun=new THREE.Vector3();this.inverseView=new THREE.Quaternion();
    this.targetAmbient=new THREE.Color();this.targetKey=new THREE.Color();this.sunColor=new THREE.Color();this.reset();
  }
  reset(){this.ambient.color.copy(this.baseAmbient);this.key.color.copy(this.baseKey);this.ambient.intensity=.55;this.key.intensity=.8;this.key.position.copy(this.basePosition);}
  update(sample,dt,{cameraQuaternion,sunDirection}={}){
    if(!sample||dt<=0)return;
    const light=sample.ambient.map(v=>Number.isFinite(v)?Math.max(0,v):.115);
    const luminance=.2126*light[0]+.7152*light[1]+.0722*light[2],sun=THREE.MathUtils.clamp(sample.sunVisibility||0,0,1),blend=1-Math.exp(-5*Math.min(dt,.1));
    const ambient=THREE.MathUtils.clamp(.49+luminance*.5+sun*.08,.53,.85),key=.77+sun*.4;
    this.targetAmbient.fromArray(light).multiplyScalar(.5/Math.max(.05,luminance));
    this.targetAmbient.lerp(this.baseAmbient,.82);
    this.targetKey.copy(this.baseKey).lerp(this.sunColor.fromArray(sample.sunColor),sun*.22);
    this.ambient.intensity=THREE.MathUtils.lerp(this.ambient.intensity,ambient,blend);this.key.intensity=THREE.MathUtils.lerp(this.key.intensity,key,blend);
    this.ambient.color.lerp(this.targetAmbient,blend);this.key.color.lerp(this.targetKey,blend);
    // The viewmodel scene is camera-local. Transform the existing world sun
    // into that space, so turning no longer turns the sunlight with the gun.
    // Keep a modest camera-side fill for readable sights in every direction.
    this.targetPosition.copy(this.basePosition);
    if(cameraQuaternion&&sunDirection&&sunDirection.lengthSq()>.001){
      this.inverseView.copy(cameraQuaternion).invert();
      this.localSun.copy(sunDirection).normalize().applyQuaternion(this.inverseView).multiplyScalar(Math.max(1,this.basePosition.length()));
      this.targetPosition.lerp(this.localSun,sun*.6);
    }
    this.key.position.lerp(this.targetPosition,blend);
  }
  snapshot(){return {ambient:this.ambient.intensity,key:this.key.intensity,ambientColor:this.ambient.color.toArray(),keyColor:this.key.color.toArray(),keyPosition:this.key.position.toArray()};}
}
