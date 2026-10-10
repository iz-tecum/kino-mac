import * as THREE from 'three';

// The Mystery Box locator is intentionally supernatural. A soft camera-facing
// ribbon avoids the former solid-looking cylinder and abrupt circular end.
export function createBoxBeacon(){
  const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:`varying vec2 tex;void main(){tex=uv;vec3 center=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
      vec3 eye=cameraPosition-center;vec3 side=normalize(vec3(eye.z,0.,-eye.x)+vec3(.00001,0.,0.));
      vec3 p=center+vec3(0.,position.y,0.)+side*position.x;
      gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
    fragmentShader:`varying vec2 tex;void main(){float width=pow(max(0.,1.-abs(tex.x-.5)*2.),3.);
      float ends=smoothstep(0.,.06,tex.y)*smoothstep(0.,.24,1.-tex.y);
      gl_FragColor=vec4(.30,.52,.9,width*ends*.16);}`,
  });
  const beam=new THREE.Mesh(new THREE.PlaneGeometry(100,1600),material);beam.name='Mystery Box locator glow';return beam;
}

// Original replacement sky and particulate scattering. Native aperture meshes
// remain intact; offline optical rays determine where every shaft can exist.
export function restoreTheaterSky(root, direction) {
  const shader = new THREE.ShaderMaterial({
    name:'Kino reconstructed daylight sky', side:THREE.DoubleSide, depthWrite:false,
    uniforms:{sunDirection:{value:new THREE.Vector3(...direction).normalize()}},
    vertexShader:`varying vec3 skyPosition;
      void main(){vec4 p=modelMatrix*vec4(position,1.);skyPosition=p.xyz;
      gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`varying vec3 skyPosition; uniform vec3 sunDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
      void main(){vec3 d=normalize(skyPosition-cameraPosition);float h=clamp(d.y,0.,1.);
      vec3 color=mix(vec3(.48,.49,.46),vec3(.19,.28,.38),pow(h,.55));
      vec2 p=d.xz/max(.2,d.y+.35)*3.;float cloud=noise(p)*.65+noise(p*2.1)*.25+noise(p*4.3)*.1;
      color=mix(color,vec3(.55,.56,.54),smoothstep(.47,.74,cloud)*.58);
      float s=max(0.,dot(d,sunDirection));color+=vec3(.28,.23,.15)*pow(s,24.);
      color+=vec3(.9,.76,.52)*smoothstep(.9996,.9999,s);
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  let meshes=0;
  root.traverse(mesh=>{if(!mesh.isMesh)return;
    const replace=m=>{if(!/sky_day/.test(m.name))return m;meshes++;return shader;};
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(replace):replace(mesh.material);
  });
  if(!meshes)shader.dispose();
  return {meshes,material:meshes?shader:null};
}

export class TheaterDaylight {
  constructor(scene, plan) {
    this.plan=plan;this.group=new THREE.Group();this.group.name='Measured window and roof daylight';scene.add(this.group);
    const points=[],phase=[],drift=[];
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      uniforms:{opacity:{value:.035},start:{value:new THREE.Vector3()},end:{value:new THREE.Vector3()},radius:{value:1}},
      vertexShader:`varying vec2 tex;uniform vec3 start;uniform vec3 end;uniform float radius;
        void main(){tex=uv;vec3 axis=normalize(end-start),middle=(start+end)*.5;
        vec3 side=cross(axis,normalize(cameraPosition-middle));float size=length(side);
        side=size>.001?side/size:normalize(cross(axis,abs(axis.y)<.99?vec3(0.,1.,0.):vec3(1.,0.,0.)));
        vec3 p=mix(start,end,uv.y)+side*(uv.x-.5)*radius*2.;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
      fragmentShader:`varying vec2 tex;uniform float opacity;void main(){float radial=pow(max(0.,1.-pow(abs(tex.x-.5)*2.,2.)),2.4);
        float ends=smoothstep(0.,.17,tex.y)*smoothstep(0.,.3,1.-tex.y);
        gl_FragColor=vec4(.94,.86,.67,opacity*radial*ends);}`,

    });
    let seed=1943;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(const shaft of plan.shafts){
      const a=new THREE.Vector3(...shaft.start),b=new THREE.Vector3(...shaft.end),d=b.clone().sub(a),length=d.length();
      if(length<10||!Number.isFinite(length)||!(shaft.radius>0))continue;
      const material=this.material.clone();material.uniforms.opacity.value=.065*shaft.transmission;material.uniforms.start.value.copy(a);material.uniforms.end.value.copy(b);material.uniforms.radius.value=shaft.radius;
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,1),material);
      mesh.name=shaft.id;mesh.frustumCulled=false;this.group.add(mesh);
      const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,-1,0),d.clone().normalize());
      const u=new THREE.Vector3(1,0,0).applyQuaternion(orientation),v=new THREE.Vector3(0,0,1).applyQuaternion(orientation);
      for(let i=0;i<22;i++){const t=.08+random()*.84,r=Math.sqrt(random())*shaft.radius*.7,angle=random()*Math.PI*2;
        const p=a.clone().addScaledVector(d,t).addScaledVector(u,Math.cos(angle)*r).addScaledVector(v,Math.sin(angle)*r);
        points.push(...p.toArray());phase.push(random()*Math.PI*2);drift.push(Math.min(1,shaft.radius*.1));
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('phase',new THREE.Float32BufferAttribute(phase,1));geometry.setAttribute('drift',new THREE.Float32BufferAttribute(drift,1));
    this.dustMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
      uniforms:{time:{value:0},pixelHeight:{value:900}},
      vertexShader:`attribute float phase;attribute float drift;uniform float time;uniform float pixelHeight;varying float fade;void main(){vec3 p=position;p.x+=sin(time*.23+phase)*drift;p.y+=cos(time*.19+phase)*drift;vec4 v=modelViewMatrix*vec4(p,1.);fade=clamp(1.-length(v.xyz)/1200.,0.,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(pixelHeight/max(1.,-v.z),1.,3.);}`,
      fragmentShader:`varying float fade;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(.9,.84,.66,(1.-r)*fade*.32);}`,
    });
    this.dust=new THREE.Points(geometry,this.dustMaterial);this.dust.name='Sunlit dust';this.group.add(this.dust);
  }
  update(time,{quality='balanced',pixelHeight=900}={}){this.group.visible=quality!=='performance';this.dustMaterial.uniforms.time.value=time;this.dustMaterial.uniforms.pixelHeight.value=pixelHeight;}
  snapshot(){return {shafts:this.plan.shafts.length,dust:this.dust.geometry.attributes.position.count,visible:this.group.visible,skyMeshes:this.sky?.meshes??0};}
}

export async function loadTheaterDaylight(scene,root){
  const response=await fetch('theater-daylight.json');if(!response.ok)throw new Error('Theater daylight data: '+response.status);
  const plan=await response.json();if(plan.version!==1||!Array.isArray(plan.shafts))throw new Error('Unsupported daylight data');
  const daylight=new TheaterDaylight(scene,plan);daylight.sky=restoreTheaterSky(root,plan.sunDirection);return daylight;
}
