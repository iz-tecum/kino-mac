import * as THREE from 'three';

// Original replacement effects, placed in the recovered map's authored volumes.
// These do not stand in for the unavailable original T5 lightmaps or volumetrics.
export class TheaterAtmosphere {
  constructor(scene,data){
    const rooms=data.entities.filter(e=>e.classname==='info_volume'&&e.script_noteworthy==='player_volume'&&e.bounds);
    const positions=[],ranges=[],seeds=[];let seed=1902;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(const room of rooms){const [lo,hi]=room.bounds;for(let i=0;i<18;i++){
      positions.push(lo[0]+random()*(hi[0]-lo[0]),lo[1]+random()*(hi[1]-lo[1]),lo[2]+random()*(hi[2]-lo[2]));ranges.push(lo[1]+8,Math.max(10,hi[1]-lo[1]-16));seeds.push(random());
    }}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('range',new THREE.Float32BufferAttribute(ranges,2));geometry.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,1));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},powered:{value:0},pixelHeight:{value:900}},
      vertexShader:'attribute vec2 range; attribute float seed; uniform float time; uniform float pixelHeight; varying float fade; void main(){vec3 p=position; p.y=range.x+mod(position.y-range.x-time*(1.5+seed*2.),range.y); p.x+=sin(time*.13+seed*25.)*4.; vec4 v=modelViewMatrix*vec4(p,1.); fade=clamp(1.-length(v.xyz)/850.,0.,1.); gl_Position=projectionMatrix*v; gl_PointSize=clamp(pixelHeight*.75/max(1.,-v.z),1.,3.5);}',
      fragmentShader:'uniform float powered; varying float fade; void main(){float r=length(gl_PointCoord-.5)*2.; if(r>1.)discard; gl_FragColor=vec4(.72,.68,.56,(1.-r)*fade*(.1+powered*.09));}'
    });
    this.dust=new THREE.Points(geometry,this.material);this.dust.name='Theater dust';this.dust.frustumCulled=false;scene.add(this.dust);
    const origin=data.entities.find(e=>e.targetname==='struct_theater_projector_beam'),screen=data.entities.find(e=>e.targetname==='struct_theater_screen');
    if(origin&&screen){
      const a=new THREE.Vector3(...origin.position),b=new THREE.Vector3(...screen.position),direction=b.clone().sub(a),length=direction.length();
      const g=new THREE.CylinderGeometry(2,145,length,24,1,true);
      const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{intensity:{value:.025}},
        vertexShader:'varying vec2 tex; varying vec3 norm; varying vec3 eye; void main(){tex=uv;vec4 p=modelViewMatrix*vec4(position,1.);norm=normalize(normalMatrix*normal);eye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
        fragmentShader:'varying vec2 tex; varying vec3 norm; varying vec3 eye; uniform float intensity; void main(){float edge=pow(1.-abs(dot(normalize(norm),normalize(eye))),1.5); float ends=sin(clamp(tex.y,.0,1.)*3.14159);gl_FragColor=vec4(.64,.73,.86,intensity*edge*ends);}'
      });
      this.beam=new THREE.Mesh(g,m);this.beam.name='Projection beam';this.beam.position.copy(a).addScaledVector(direction,.5);this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),direction.normalize());this.beam.visible=false;scene.add(this.beam);
    }
  }
  update(time,power,{quality='balanced',reducedFlashes=false,pixelHeight=900}={}){
    this.dust.visible=quality!=='performance';this.material.uniforms.time.value=time;this.material.uniforms.powered.value=power?1:0;this.material.uniforms.pixelHeight.value=pixelHeight;
    if(this.beam){this.beam.visible=power&&quality!=='performance';this.beam.material.uniforms.intensity.value=reducedFlashes?.016:.022+Math.sin(time*8)*.002;}
  }
}
