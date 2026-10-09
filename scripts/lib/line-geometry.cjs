// Shared source-independent line handling for all city data generators.
function extractLineCoords(geometry){
  if(geometry?.type==='LineString')return [geometry.coordinates];
  if(geometry?.type==='MultiLineString')return geometry.coordinates;
  return [];
}
function clipLineSegments(geometry,bbox,turf){
  const feature={type:'Feature',properties:{},geometry};
  return extractLineCoords(bbox?turf.bboxClip(feature,bbox).geometry:geometry)
    .filter(coords=>Array.isArray(coords)&&coords.length>1);
}
module.exports={extractLineCoords,clipLineSegments};
