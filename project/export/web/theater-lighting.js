import * as THREE from 'three';

// Shadowed architecture is baked from native geometry. A bounded pool gently
// lights moving actors/props near practicals; it is never the primary room fill.
export class TheaterLighting{
  constructor(scene){
    this.scene=scene;this.sources=[];this.nextUpdate=0;this.powerAt=null;
    this.pool=Array.from({length:4},()=>{const light=new THREE.PointLight(0xffca82,0,700,1);scene.add(light);return light;});
  }
  bind(world){
    this.world=world;this.field=world.lightfield;
    this.sources=this.field.manifest.plan.sources.map(source=>({...source,position:new THREE.Vector3(...source.position),color:new THREE.Color(...source.color)}));
    const fixtures=this.sources.filter(s=>s.glowRadius),positions=[],colors=[],radii=[],powered=[];
    for(const s of fixtures)for(const p of s.glowPositions??[s.position.toArray()]){positions.push(...p);colors.push(s.color.r,s.color.g,s.color.b);radii.push(s.glowRadius);powered.push(s.powered?1:0);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('radius',new THREE.Float32BufferAttribute(radii,1));geometry.setAttribute('powered',new THREE.Float32BufferAttribute(powered,1));
    this.glowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
      uniforms:{power:this.field.power,pixelHeight:{value:900}},
      vertexShader:'attribute vec3 color;attribute float radius;attribute float powered;uniform float power;uniform float pixelHeight;varying vec3 tint;varying float amount;void main(){vec4 p=modelViewMatrix*vec4(position,1.);tint=color;amount=mix(1.,power,powered);gl_Position=projectionMatrix*p;gl_PointSize=clamp(pixelHeight*radius/max(1.,-p.z),1.,48.);}',
      fragmentShader:'varying vec3 tint;varying float amount;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(tint,pow(1.-r,1.4)*amount*.65);}'
    });
    this.glows=new THREE.Points(geometry,this.glowMaterial);this.glows.name='Native practical lamp filaments';this.scene.add(this.glows);
  }
  prepareActors(enemies){
    // T5 actor light probes are missing. Preserve a small cool diffuse floor on
    // creature materials so silhouettes remain readable in unlit recesses.
    // This does not brighten architecture or make the actors emit world light.
    const variants=new Map();
    for(const root of [...enemies.templates,...enemies.heads,enemies.dog,enemies.quad,enemies.quadHead].filter(Boolean))root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const apply=material=>{
        if(!material.isMeshStandardMaterial)return material;
        if(!variants.has(material)){
          const shade=material.clone();shade.userData={...material.userData,kinoActorProbe:true};
          shade.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>',
            '#include <lights_fragment_maps>\n#if defined(RE_IndirectDiffuse)\nirradiance += PI * vec3(.10,.115,.13);\n#endif');};
          shade.customProgramCacheKey=()=> 'kino-actor-probe-v1';variants.set(material,shade);
        }
        return variants.get(material);
      };
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(apply):apply(mesh.material);
    });
  }
  update(position,power,time,{pixelHeight=900}={}){
    if(!this.field)return;
    if(power&&this.powerAt===null)this.powerAt=time;
    this.field.power.value=power?THREE.MathUtils.smoothstep(time-this.powerAt,0,1.6):0;
    this.glowMaterial.uniforms.pixelHeight.value=pixelHeight;
    if(time<this.nextUpdate)return;this.nextUpdate=time+.3;
    const sources=this.sources.filter(s=>!s.noAccent&&(!s.powered||power)&&s.position.distanceToSquared(position)<900**2)
      .sort((a,b)=>a.position.distanceToSquared(position)-b.position.distanceToSquared(position))
      .filter(s=>this.world.lineClear(position,s.position)).slice(0,this.pool.length);
    for(let i=0;i<this.pool.length;i++){
      const light=this.pool[i],source=sources[i];
      if(!source){light.intensity=0;continue;}
      light.position.copy(source.position);light.color.copy(source.color);light.distance=Math.min(550,source.radius);
      light.intensity=32*(source.powered?this.field.power.value:1);
    }
  }
  reset(){this.nextUpdate=0;this.powerAt=null;this.field?.reset();for(const light of this.pool)light.intensity=0;}
  snapshot(){return{sources:this.sources.length,power:this.field?.power.value||0,activeAccents:this.pool.filter(l=>l.intensity>0).length,glows:this.glows?.geometry.attributes.position.count||0};}
}
