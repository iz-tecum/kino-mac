import * as THREE from 'three';

// The original entity has a classname typo and was omitted by the exporter.
// Reuse the native static-mesh instance, preserving its original scale/material.
export function restoreTheaterFixtures(root,data){
  const result={restored:[],source:'Original map entity and supplied fixture geometry'};
  const fixture=data.entities.find(e=>Number(e.id)===2715&&e.model==='p_glo_stage_light');
  let template;
  root.traverse(object=>{if(!template&&/^i_p_glo_stage_light(?:_\d+)?$/.test(object.name))template=object;});
  const alreadyPresent=fixture&&root.getObjectByName('restored_stage_fixture_2715');
  let bakedAtPosition=false;
  if(fixture)root.traverse(object=>{if(/^i_p_glo_stage_light(?:_\d+)?$/.test(object.name)&&object.position.distanceTo(new THREE.Vector3(...fixture.position))<1)bakedAtPosition=true;});
  if(fixture&&template&&!alreadyPresent&&!bakedAtPosition){
    const clone=template.clone(true);clone.name='restored_stage_fixture_2715';
    clone.position.fromArray(fixture.position);clone.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),fixture.yaw||0);
    clone.matrixAutoUpdate=true;clone.updateMatrix();root.add(clone);result.restored.push(2715);
  }
  return result;
}
