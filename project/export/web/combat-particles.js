import * as THREE from 'three';

const profiles=Object.freeze({
  debris:{speed:110,up:95,life:.4,variation:.35,size:2.6,gravity:200,drag:0,shape:0},
  wall:{speed:90,up:15,life:.32,variation:.32,size:3.7,gravity:100,drag:4,shape:1},
  wood:{speed:110,up:15,life:.32,variation:.3,size:3.1,gravity:180,drag:2,shape:4},
  metal:{speed:175,up:15,life:.18,variation:.22,size:1.9,gravity:160,drag:1,shape:2},
  blood:{speed:85,up:12,life:.24,variation:.3,size:1.25,gravity:140,drag:2,shape:3,tint:.45},
  blast:{speed:200,up:110,life:.35,variation:.4,size:4.5,gravity:135,drag:2,shape:1},
  energy:{speed:150,up:40,life:.24,variation:.28,size:3,gravity:20,drag:3,shape:2},
});
const finiteVector=v=>v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z);

// One fixed GPU allocation for every impact type; emission never creates scene
// nodes, materials or textures. This pool survives rounds and game resets.
export class CombatParticles {
  constructor(scene,capacity=512,random=Math.random){
    this.capacity=capacity=Math.max(1,Math.floor(Number.isFinite(capacity)?capacity:512));this.random=random;this.cursor=0;this.active=0;this.emitted=0;this.byKind={};this.lastEmission=null;
    this.positions=new Float32Array(capacity*3);this.colors=new Float32Array(capacity*3);
    this.opacity=new Float32Array(capacity);this.velocity=new Float32Array(capacity*3);this.life=new Float32Array(capacity);this.duration=new Float32Array(capacity);
    this.sizes=new Float32Array(capacity);this.baseSizes=new Float32Array(capacity);this.shapes=new Float32Array(capacity);this.gravity=new Float32Array(capacity);this.drag=new Float32Array(capacity);
    this.geometry=new THREE.BufferGeometry();
    for(const [name,array,size] of [['position',this.positions,3],['color',this.colors,3],['alpha',this.opacity,1],['particleSize',this.sizes,1],['shape',this.shapes,1]])this.geometry.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{pixelHeight:{value:900}},
      vertexShader:'attribute float alpha; attribute float particleSize; attribute float shape; varying vec3 tint; varying float fade; varying float kind; uniform float pixelHeight; void main(){ tint=color; fade=alpha; kind=shape; vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_PointSize=alpha>0.?clamp(pixelHeight*particleSize/max(1.,-p.z),1.,32.):0.; }',
      fragmentShader:'varying vec3 tint; varying float fade; varying float kind; void main(){ vec2 uv=gl_PointCoord-.5; float r=length(uv)*2.; if(r>1.||fade<=0.)discard; float edge=1.-smoothstep(.3,1.,r); if(kind>.5&&kind<1.5)edge=exp(-r*r*4.)*(1.-smoothstep(.75,1.,r))*.65; else if(kind>3.5){float a=fract(kind)*6.28318; vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*uv; edge=(1.-smoothstep(.06,.12,abs(q.x)))*(1.-smoothstep(.3,.45,abs(q.y)));} else if(kind>1.5&&kind<2.5){float a=fract(kind)*12.56636; vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*uv; edge=(1.-smoothstep(.025,.09,abs(q.x)))*(1.-smoothstep(.2,.5,abs(q.y)));} else if(kind>2.5)edge=1.-smoothstep(.55,1.,r); gl_FragColor=vec4(tint,fade*edge);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
    });
    this.points=new THREE.Points(this.geometry,this.material);this.points.name='Combat impact pool';this.points.frustumCulled=false;this.points.visible=false;scene.add(this.points);
    this.color=new THREE.Color();this.axis=new THREE.Vector3();this.tangent=new THREE.Vector3();this.bitangent=new THREE.Vector3();this.launch=new THREE.Vector3();
  }
  emit(position,color=0x9e3023,count=7,options={}){
    if(!finiteVector(position)||!Number.isFinite(count)||count<=0)return 0;
    const kind=Object.hasOwn(profiles,options.kind)?options.kind:'debris',profile=profiles[kind],nParticles=Math.min(Math.floor(count),this.capacity);
    this.color.setHex(color);
    const directed=finiteVector(options.normal)||finiteVector(options.direction);
    this.axis.set(0,1,0);
    if(finiteVector(options.normal))this.axis.copy(options.normal);
    else if(finiteVector(options.direction))this.axis.copy(options.direction).negate();
    if(this.axis.lengthSq()<1e-8)this.axis.set(0,1,0);this.axis.normalize();
    this.tangent.set(Math.abs(this.axis.y)<.9?0:1,Math.abs(this.axis.y)<.9?1:0,0).cross(this.axis).normalize();
    this.bitangent.crossVectors(this.axis,this.tangent);
    for(let n=0;n<nParticles;n++){
      const i=this.cursor++%this.capacity,k=i*3;
      this.positions.set([position.x+(directed?this.axis.x*.6:0),position.y+(directed?this.axis.y*.6:0),position.z+(directed?this.axis.z*.6:0)],k);
      const tint=profile.tint??1;this.colors.set([this.color.r*tint,this.color.g*tint,this.color.b*tint],k);
      if(directed){
        const angle=this.random()*Math.PI*2,spread=Math.sqrt(this.random())*.85;
        this.launch.copy(this.axis).multiplyScalar(.5+this.random()*.5).addScaledVector(this.tangent,Math.cos(angle)*spread).addScaledVector(this.bitangent,Math.sin(angle)*spread).normalize().multiplyScalar(profile.speed*(.45+this.random()*.55));
        this.velocity.set([this.launch.x,this.launch.y,this.launch.z],k);
      }else this.velocity.set([(this.random()-.5)*profile.speed,this.random()*profile.up,(this.random()-.5)*profile.speed],k);
      this.duration[i]=this.life[i]=profile.life+this.random()*profile.variation;this.opacity[i]=1;
      this.baseSizes[i]=this.sizes[i]=profile.size*(.7+this.random()*.6);this.shapes[i]=profile.shape+([2,4].includes(profile.shape)?this.random()*.49:0);this.gravity[i]=profile.gravity;this.drag[i]=profile.drag;
    }
    this.emitted+=nParticles;this.byKind[kind]=(this.byKind[kind]??0)+nParticles;
    this.lastEmission={kind,count:nParticles,position:[position.x,position.y,position.z],normal:directed?this.axis.toArray():null};
    for(const attribute of Object.values(this.geometry.attributes))attribute.needsUpdate=true;
    return nParticles;
  }
  update(dt,pixelHeight){
    dt=Number.isFinite(dt)?Math.max(0,dt):0;
    if(Number.isFinite(pixelHeight)&&pixelHeight>0)this.material.uniforms.pixelHeight.value=pixelHeight;
    this.active=0;
    for(let i=0;i<this.capacity;i++){
      if(this.life[i]<=0)continue;
      const elapsed=Math.min(dt,this.life[i]),k=i*3,drag=this.drag[i],gravity=this.gravity[i];
      // Analytic constant gravity + linear drag avoids a different trajectory
      // at low frame rates. A zero simulation step changes no particle state.
      if(elapsed>0){
        const decay=Math.exp(-drag*elapsed),travel=drag>0?(1-decay)/drag:elapsed;
        for(let a=0;a<3;a++){
          const acceleration=a===1?-gravity:0;
          this.positions[k+a]+=this.velocity[k+a]*travel+(drag>0?acceleration/drag*(elapsed-travel):.5*acceleration*elapsed*elapsed);
          this.velocity[k+a]=this.velocity[k+a]*decay+acceleration*travel;
        }
        this.life[i]=Math.max(0,this.life[i]-elapsed);this.opacity[i]=this.life[i]/this.duration[i];
        this.sizes[i]=this.baseSizes[i]*(this.shapes[i]===1?1+(1-this.opacity[i])*.8:1);
      }
      if(this.life[i]>0)this.active++;
    }
    for(const name of ['position','alpha','particleSize'])this.geometry.attributes[name].needsUpdate=true;
    this.points.visible=this.active>0;
  }
  reset(){this.life.fill(0);this.opacity.fill(0);this.cursor=0;this.active=0;this.emitted=0;this.byKind={};this.lastEmission=null;this.points.visible=false;this.geometry.attributes.alpha.needsUpdate=true;}
  snapshot(){return {active:this.active,capacity:this.capacity,drawCalls:this.points.visible?1:0,emitted:this.emitted,byKind:{...this.byKind},lastEmission:this.lastEmission};}
}
