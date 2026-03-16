#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const OUTPUT = path.resolve(__dirname, '..', 'data', 'boundaries.json');
const MBTA_DATA = path.resolve(__dirname, '..', 'data', 'mbta-data.json');
const BBOX = {south: 41.85, west: -71.70, north: 42.80, east: -70.40};
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const NOMINATIM_DELAY_MS = 1200;

async function fetchJSON(url, options = {}){
  const res = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'Jetlag-MBTA-Boundary-Generator/1.0',
      ...(options.headers || {}),
    },
  });
  if(!res.ok){
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function sleep(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function overpassRaw(query){
  for(const url of OVERPASS_ENDPOINTS){
    try{
      return await fetchJSON(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'data=' + encodeURIComponent(query),
      });
    }catch(err){}
  }
  throw new Error('All Overpass endpoints failed');
}

function coordKey(coord){
  return `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
}

function sameCoord(a, b){
  return coordKey(a) === coordKey(b);
}

function closeRing(ring){
  if(!ring.length) return ring;
  return sameCoord(ring[0], ring[ring.length - 1]) ? ring : [...ring, ring[0]];
}

function ringArea(ring){
  let area = 0;
  for(let i = 0; i < ring.length - 1; i++){
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += (x1 * y2) - (x2 * y1);
  }
  return area / 2;
}

function pointInRing(point, ring){
  let inside = false;
  const [px, py] = point;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if(intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry){
  if(!geometry) return false;
  if(geometry.type === 'Polygon'){
    const [outer, ...holes] = geometry.coordinates;
    if(!pointInRing(point, outer)) return false;
    return !holes.some(hole => pointInRing(point, hole));
  }
  if(geometry.type === 'MultiPolygon'){
    return geometry.coordinates.some(poly => pointInGeometry(point, {type:'Polygon', coordinates: poly}));
  }
  return false;
}

function simplifyRing(ring, tolerance = 0.0004){
  if(!Array.isArray(ring) || ring.length < 5) return ring;
  const simplified = [ring[0]];
  let last = ring[0];
  for(let i = 1; i < ring.length - 1; i++){
    const point = ring[i];
    if(Math.abs(point[0] - last[0]) >= tolerance || Math.abs(point[1] - last[1]) >= tolerance){
      simplified.push(point);
      last = point;
    }
  }
  simplified.push(ring[ring.length - 1]);
  return simplified.length >= 4 ? simplified : ring;
}

function simplifyGeometry(geometry){
  if(!geometry) return null;
  if(geometry.type === 'Polygon'){
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(ring => simplifyRing(ring)),
    };
  }
  if(geometry.type === 'MultiPolygon'){
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(poly => poly.map(ring => simplifyRing(ring))),
    };
  }
  return geometry;
}

function stitchSegments(segments){
  const pool = segments
    .map(segment => segment.filter((coord, idx, arr) => idx === 0 || !sameCoord(coord, arr[idx - 1])))
    .filter(segment => segment.length >= 2);
  const rings = [];

  while(pool.length){
    let current = pool.shift().slice();
    let changed = true;

    while(changed){
      changed = false;
      for(let i = 0; i < pool.length; i++){
        const candidate = pool[i];
        const start = current[0];
        const end = current[current.length - 1];
        const candStart = candidate[0];
        const candEnd = candidate[candidate.length - 1];

        if(sameCoord(end, candStart)){
          current = current.concat(candidate.slice(1));
        } else if(sameCoord(end, candEnd)){
          current = current.concat(candidate.slice(0, -1).reverse());
        } else if(sameCoord(start, candEnd)){
          current = candidate.slice(0, -1).concat(current);
        } else if(sameCoord(start, candStart)){
          current = candidate.slice(1).reverse().concat(current);
        } else {
          continue;
        }

        pool.splice(i, 1);
        changed = true;
        break;
      }
    }

    current = closeRing(current);
    if(current.length >= 4 && sameCoord(current[0], current[current.length - 1])){
      rings.push(current);
    }
  }

  return rings;
}

function relationToGeometry(relation){
  const outerSegments = [];
  const innerSegments = [];

  for(const member of relation.members || []){
    if(member.type !== 'way' || !member.geometry || member.geometry.length < 2) continue;
    const segment = member.geometry.map(point => [point.lon, point.lat]);
    if(member.role === 'inner') innerSegments.push(segment);
    else outerSegments.push(segment);
  }

  const outerRings = stitchSegments(outerSegments)
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const innerRings = stitchSegments(innerSegments);
  if(!outerRings.length) return null;

  const polygons = outerRings.map(ring => ({outer: ring, holes: []}));

  for(const hole of innerRings){
    const point = hole[0];
    const container = polygons.find(poly => pointInRing(point, poly.outer));
    if(container) container.holes.push(hole);
  }

  const coords = polygons.map(poly => [poly.outer, ...poly.holes]);
  if(coords.length === 1) return {type: 'Polygon', coordinates: coords[0]};
  return {type: 'MultiPolygon', coordinates: coords};
}

async function loadStops(){
  const data = JSON.parse(await fs.readFile(MBTA_DATA, 'utf8'));
  const deduped = new Map();
  for(const line of data.lines || []){
    for(const stop of line.stops || []){
      if(!deduped.has(stop.id)){
        deduped.set(stop.id, {id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng});
      }
    }
  }
  return [...deduped.values()];
}

async function fetchBoundaryRelations(queryBody){
  const query = `[out:json][timeout:120];
    ${queryBody}
    out geom;`;
  const data = await overpassRaw(query);
  return (data.elements || []).filter(el => el.type === 'relation');
}

function boundaryNameForRelation(relation, type){
  const tags = relation.tags || {};
  if(type === 'postcode'){
    return tags.postal_code || tags.ref || tags.name || `postcode-${relation.id}`;
  }
  return tags.name || `relation-${relation.id}`;
}

function filterRelationsByStops(relations, stops, type){
  const seen = new Set();
  const filtered = [];
  for(const relation of relations){
    const geometry = simplifyGeometry(relationToGeometry(relation));
    if(!geometry) continue;
    const containsPlayableStop = stops.some(stop => pointInGeometry([stop.lng, stop.lat], geometry));
    if(!containsPlayableStop) continue;
    const name = boundaryNameForRelation(relation, type);
    const key = `${type}:${String(name).toLowerCase()}`;
    if(seen.has(key)) continue;
    seen.add(key);
    filtered.push({
      name,
      geometry,
    });
  }
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

async function reverseGeocodeStop(stop, zoom = null){
  const params = new URLSearchParams({
    lat: String(stop.lat),
    lon: String(stop.lng),
    format: 'json',
    addressdetails: '1',
  });
  if(zoom) params.set('zoom', String(zoom));
  const url = `${NOMINATIM_BASE}/reverse?${params.toString()}`;
  const data = await fetchJSON(url, {
    headers: {
      'Accept-Language': 'en-US',
      'User-Agent': 'Jetlag-MBTA-Boundary-Generator/1.0',
    },
  });
  await sleep(NOMINATIM_DELAY_MS);
  return data;
}

async function searchNominatimPolygon(query){
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    polygon_geojson: '1',
    countrycodes: 'us',
  });
  const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
  const items = await fetchJSON(url, {
    headers: {
      'Accept-Language': 'en-US',
      'User-Agent': 'Jetlag-MBTA-Boundary-Generator/1.0',
    },
  });
  await sleep(NOMINATIM_DELAY_MS);
  return Array.isArray(items) ? items : [];
}

function featureFromGeoJSON(name, geometry){
  if(!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
  return {name, geometry};
}

function bestNominatimPolygon(items){
  const scored = (items || [])
    .filter(item => item.geojson && (item.geojson.type === 'Polygon' || item.geojson.type === 'MultiPolygon'))
    .map(item => ({
      item,
      score:
        (item.class === 'boundary' ? 4 : 0) +
        (item.type === 'administrative' ? 3 : 0) +
        (item.type === 'postcode' ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

async function loadNominatimPlaceSeeds(stops){
  const neighborhoods = new Set();
  const postcodes = new Set();

  for(const stop of stops){
    try{
      const data = await reverseGeocodeStop(stop, 16);
      const addr = data.address || {};
      const neighborhood = addr.suburb || addr.neighbourhood || addr.quarter || null;
      const postcode = addr.postcode || null;
      if(neighborhood) neighborhoods.add(neighborhood);
      if(postcode) postcodes.add(postcode);
    }catch(err){
      console.warn(`Reverse geocode failed for ${stop.name}:`, err.message);
    }
  }

  return {
    neighborhoods: [...neighborhoods].sort(),
    postcodes: [...postcodes].sort(),
  };
}

async function fetchNominatimBoundaries(names, type){
  const out = [];
  for(const name of names){
    try{
      const query = type === 'postcode'
        ? `${name} Massachusetts`
        : `${name} Boston Massachusetts`;
      const best = bestNominatimPolygon(await searchNominatimPolygon(query));
      const feature = featureFromGeoJSON(name, best?.geojson);
      if(feature) out.push(feature);
    }catch(err){
      console.warn(`Nominatim boundary fetch failed for ${name}:`, err.message);
    }
  }
  return out;
}

function mergeNamedFeatures(primary, supplemental, stops){
  const merged = [...primary];
  const seen = new Set(primary.map(item => item.name.toLowerCase()));
  for(const item of supplemental){
    const key = item.name.toLowerCase();
    if(seen.has(key)) continue;
    if(!stops.some(stop => pointInGeometry([stop.lng, stop.lat], item.geometry))) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

async function main(){
  console.log('Loading MBTA stops...');
  const stops = await loadStops();
  console.log(`Loaded ${stops.length} unique stops`);

  console.log('Fetching county boundary relations...');
  const countyRelations = await fetchBoundaryRelations(
    `relation["boundary"="administrative"]["admin_level"="6"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`
  );
  console.log(`Fetched ${countyRelations.length} county relations`);

  console.log('Fetching city/town boundary relations...');
  const cityRelations = await fetchBoundaryRelations(
    `relation["boundary"="administrative"]["admin_level"="8"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`
  );
  console.log(`Fetched ${cityRelations.length} city/town relations`);

  console.log('Fetching neighborhood boundary relations...');
  const neighborhoodRelations = await fetchBoundaryRelations(
    `relation["boundary"="administrative"]["admin_level"="10"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`
  );
  console.log(`Fetched ${neighborhoodRelations.length} neighborhood relations`);

  console.log('Fetching postcode boundary relations...');
  const postcodeRelations = await fetchBoundaryRelations(
    `(
      relation["boundary"="postal_code"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      relation["postal_code"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );`
  );
  console.log(`Fetched ${postcodeRelations.length} postcode relations`);

  console.log('Building and filtering county polygons...');
  const counties = filterRelationsByStops(countyRelations, stops, 'county');
  console.log(`Kept ${counties.length} counties`);

  console.log('Building and filtering city/town polygons...');
  const cities = filterRelationsByStops(cityRelations, stops, 'city');
  console.log(`Kept ${cities.length} cities/towns`);

  console.log('Building and filtering neighborhood polygons...');
  let neighborhoods = filterRelationsByStops(neighborhoodRelations, stops, 'neighborhood');
  console.log(`Kept ${neighborhoods.length} neighborhoods from Overpass`);

  console.log('Building and filtering postcode polygons...');
  let postcodes = filterRelationsByStops(postcodeRelations, stops, 'postcode');
  console.log(`Kept ${postcodes.length} postcodes from Overpass`);

  if(!neighborhoods.length || postcodes.length < 3){
    console.log('Supplementing neighborhoods/postcodes via Nominatim...');
    const seeds = await loadNominatimPlaceSeeds(stops);
    console.log(`Discovered ${seeds.neighborhoods.length} neighborhoods and ${seeds.postcodes.length} postcodes from stop reverse geocoding`);

    if(!neighborhoods.length && seeds.neighborhoods.length){
      const fetchedNeighborhoods = await fetchNominatimBoundaries(seeds.neighborhoods, 'neighborhood');
      neighborhoods = mergeNamedFeatures(neighborhoods, fetchedNeighborhoods, stops);
      console.log(`Kept ${neighborhoods.length} neighborhoods after Nominatim supplement`);
    }

    if(postcodes.length < 3 && seeds.postcodes.length){
      const fetchedPostcodes = await fetchNominatimBoundaries(seeds.postcodes, 'postcode');
      postcodes = mergeNamedFeatures(postcodes, fetchedPostcodes, stops);
      console.log(`Kept ${postcodes.length} postcodes after Nominatim supplement`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    counties,
    cities,
    neighborhoods,
    postcodes,
  };

  await fs.mkdir(path.dirname(OUTPUT), {recursive: true});
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
