importScripts('https://cdnjs.cloudflare.com/ajax/libs/Turf.js/6.5.0/turf.min.js');

function toFeature(item){
  if(!item) return null;
  if(item.type === 'Feature' && item.geometry) return item;
  if(item.geometry?.type){
    return {
      type: 'Feature',
      properties: {name: item.name || ''},
      geometry: item.geometry,
    };
  }
  return null;
}

function expandBboxMiles(bbox, miles){
  if(!Array.isArray(bbox) || bbox.length !== 4 || !Number.isFinite(miles)) return bbox;
  const midLat = ((bbox[1] + bbox[3]) / 2) * Math.PI / 180;
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.max(0.2, Math.cos(midLat)));
  return [
    bbox[0] - lngDelta,
    bbox[1] - latDelta,
    bbox[2] + lngDelta,
    bbox[3] + latDelta,
  ];
}

function clipFeatureToZone(feature, zone, miles){
  if(!feature || !zone) return feature;
  try{
    const bbox = expandBboxMiles(turf.bbox(zone), miles + 0.5);
    const clipped = turf.bboxClip(feature, bbox);
    if(clipped?.geometry) return clipped;
  }catch(e){}
  return feature;
}

function simplifyMeasureFeature(feature, categoryLabel){
  if(!feature) return feature;
  const isCoast = /coast|sea level/i.test(categoryLabel || '');
  if(!isCoast) return feature;
  try{
    return turf.simplify(feature, {tolerance:0.005, highQuality:false}) || feature;
  }catch(e){
    return feature;
  }
}

function unionFeatures(features){
  let union = features[0] || null;
  for(let i = 1; i < features.length; i++){
    try{
      union = turf.union(union, features[i]) || union;
    }catch(e){}
  }
  return union;
}

function buildConstraintUnion(lineFeatures, seekerDist, zone, categoryLabel){
  if(!Array.isArray(lineFeatures) || !lineFeatures.length || !Number.isFinite(seekerDist)) return null;
  const buffered = lineFeatures
    .map(item => toFeature(item))
    .filter(Boolean)
    .map(feature => {
      try{
        const clipped = clipFeatureToZone(feature, zone, seekerDist);
        const simplified = simplifyMeasureFeature(clipped, categoryLabel);
        return turf.buffer(simplified, seekerDist, {units:'miles'});
      }catch(e){
        return null;
      }
    })
    .filter(Boolean);
  if(!buffered.length) return null;
  const union = unionFeatures(buffered);
  if(!union) return null;
  try{
    return turf.simplify(union, {tolerance:0.00025, highQuality:true}) || union;
  }catch(e){
    return union;
  }
}

function solveLinearMeasure(payload){
  const center = payload?.center || null;
  const lineFeatures = Array.isArray(payload?.lineFeatures) ? payload.lineFeatures : [];
  if(!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng)) || !lineFeatures.length){
    return null;
  }

  const point = turf.point([Number(center.lng), Number(center.lat)]);
  let best = null;
  lineFeatures.forEach(item => {
    const feature = toFeature(item);
    if(!feature) return;
    try{
      const snapped = turf.nearestPointOnLine(feature, point, {units:'miles'});
      const dist = snapped?.properties?.dist;
      if(!Number.isFinite(dist) || (best && dist >= best.dist)) return;
      const [lng, lat] = snapped.geometry.coordinates;
      best = {
        name: item.name || feature.properties?.name || payload.categoryLabel || 'Line',
        lat,
        lng,
        dist,
      };
    }catch(e){}
  });
  if(!best) return null;

  let union = null;
  const seekerDist = Number.isFinite(Number(payload?.seekerDist))
    ? Number(payload.seekerDist)
    : best.dist;
  if(payload?.buildConstraintUnion){
    union = buildConstraintUnion(lineFeatures, seekerDist, payload?.zone || null, payload?.categoryLabel || '');
  }

  return {best, union};
}

self.onmessage = (event) => {
  const {id, type, payload} = event.data || {};
  try{
    if(type !== 'solveLinearMeasure') throw new Error(`Unsupported worker request: ${type}`);
    const result = solveLinearMeasure(payload);
    self.postMessage({id, result});
  }catch(error){
    self.postMessage({id, error: error?.message || String(error)});
  }
};
