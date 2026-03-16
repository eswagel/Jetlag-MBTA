const {point, lineString, featureCollection} = require('@turf/helpers');
const {bboxPolygon} = require('@turf/bbox-polygon');
const {polygonToLine} = require('@turf/polygon-to-line');
const {polygonize} = require('@turf/polygonize');
const {booleanPointInPolygon} = require('@turf/boolean-point-in-polygon');

function haversineMiles(a, b){
  const toRad = d => d * Math.PI / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function interpolate(a, b, t){
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function dedupeCoords(coords){
  if(!Array.isArray(coords) || !coords.length) return [];
  return coords.filter((coord, index) =>
    index === 0 ||
    coord[0] !== coords[index - 1][0] ||
    coord[1] !== coords[index - 1][1]
  );
}

async function fetchCoastlineWays(overpassRaw, bbox){
  const query = `[out:json][timeout:120];
    way["natural"="coastline"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    out geom;`;
  const data = await overpassRaw(query);
  return (data.elements || []).filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2);
}

function densifyCoastlineWays(ways, stepMiles = 0.5, fallbackName = 'Coastline'){
  const out = [];
  const seen = new Set();

  function pushPoint(lat, lng, name){
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if(!seen.has(key)){
      seen.add(key);
      out.push({lat, lng, name});
    }
  }

  for(const way of ways){
    const coords = way.geometry.map(p => ({lat: p.lat, lng: p.lon}));
    const name = way.tags?.name || fallbackName;
    for(let i = 0; i < coords.length - 1; i++){
      const start = coords[i];
      const end = coords[i + 1];
      const length = haversineMiles(start, end);
      const steps = Math.max(1, Math.round(length / stepMiles));
      for(let j = 0; j <= steps; j++){
        const sample = interpolate(start, end, j / steps);
        pushPoint(sample.lat, sample.lng, name);
      }
    }
  }

  return out;
}

function buildLandFacesFromCoastlineWays(ways, bbox, stops){
  const coastLines = ways.map(way => lineString(
    dedupeCoords(way.geometry.map(p => [p.lon, p.lat])),
    {name: 'coastline'}
  )).filter(line => line.geometry.coordinates.length >= 2);
  const bboxPoly = bboxPolygon([bbox.west, bbox.south, bbox.east, bbox.north]);
  const bboxLines = polygonToLine(bboxPoly);
  const lineFeatures = [
    ...coastLines,
    ...(bboxLines.type === 'FeatureCollection' ? bboxLines.features : [bboxLines]),
  ];
  const faces = polygonize(featureCollection(lineFeatures));
  return (faces.features || []).filter(face =>
    stops.some(stop => {
      try{
        return booleanPointInPolygon(point([stop.lng, stop.lat]), face);
      }catch(err){
        return false;
      }
    })
  );
}

module.exports = {
  fetchCoastlineWays,
  densifyCoastlineWays,
  buildLandFacesFromCoastlineWays,
};
