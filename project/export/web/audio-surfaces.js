// Material-name fallback only. This is not an authored per-triangle surface map.
export function surfaceFromMaterial(material=''){
  const name=String(material).toLowerCase();
  if(/carpet|rug|fabric/.test(name))return 'carpet';
  if(/wood|timber|plank|parquet/.test(name))return 'wood';
  if(/metal|steel|iron|grate/.test(name))return 'metal';
  if(/dirt|soil|gravel|earth/.test(name))return 'dirt';
  return 'concrete';
}
