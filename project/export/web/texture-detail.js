// Preserve native images, colour spaces, UVs and mip filters. Anisotropic
// sampling only makes those existing mip chains clearer at oblique angles.
export function textureDetailLevel(quality,maximum=1,mobile=false,normal=false){
  const supported=Number.isFinite(maximum)?Math.max(1,Math.floor(maximum)):1;
  const wanted=mobile?1:quality==='performance'?2:quality==='quality'?(normal?8:16):(normal?4:8);
  return Math.min(supported,wanted);
}
export class TextureDetail {
  constructor(maximum,mobile=false){this.maximum=maximum;this.mobile=mobile;this.quality='balanced';this.records=new Map();this.changes=0;}
  register(root){
    root?.traverse(object=>{
      if(!object.isMesh)return;
      for(const material of [object.material].flat()){
        if(!material?.isMeshStandardMaterial)continue;
        for(const slot of ['map','normalMap']){
          const texture=material[slot];
          if(!texture?.isTexture||texture.isDataTexture||texture.isRenderTargetTexture||texture.isVideoTexture)continue;
          if(!this.records.has(texture))this.records.set(texture,{original:texture.anisotropy,normal:slot==='normalMap'});
          this.apply(texture,this.records.get(texture));
        }
      }
    });
  }
  apply(texture,record){
    const value=textureDetailLevel(this.quality,this.maximum,this.mobile,record.normal);
    if(texture.anisotropy===value)return;
    texture.anisotropy=value;texture.needsUpdate=true;this.changes++;
  }
  setQuality(quality){this.quality=quality;for(const [texture,record]of this.records)this.apply(texture,record);}
  snapshot(){return{quality:this.quality,hardwareMaximum:this.maximum,colourLevel:textureDetailLevel(this.quality,this.maximum,this.mobile),normalLevel:textureDetailLevel(this.quality,this.maximum,this.mobile,true),textures:this.records.size,samplerChanges:this.changes,newTextures:0};}
  dispose(){for(const [texture,record]of this.records){if(texture.anisotropy!==record.original){texture.anisotropy=record.original;texture.needsUpdate=true;}}this.records.clear();}
}
