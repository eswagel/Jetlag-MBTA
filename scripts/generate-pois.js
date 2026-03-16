#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const {fetchCoastlineWays, densifyCoastlineWays} = require('./lib/shoreline');

const OUTPUT = path.resolve(__dirname, '..', 'data', 'pois.json');
const BBOX = {south: 42.18, west: -71.55, north: 42.67, east: -70.85};
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const REQUEST_DELAY_MS = 1200;

const CATEGORY_QUERIES = {
  parks: `nwr["leisure"="park"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  golfCourses: `nwr["leisure"="golf_course"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  libraries: `nwr["amenity"="library"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  hospitals: `nwr["amenity"="hospital"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  medicalSites: `nwr["amenity"~"hospital|clinic"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  museums: `nwr["tourism"="museum"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  movieTheaters: `nwr["amenity"="cinema"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  zooAquariums: `nwr["tourism"~"^(zoo|aquarium)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  foreignConsulates: `nwr["office"~"diplomatic|consulate"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}); nwr["amenity"="embassy"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  amusementParks: `nwr["tourism"="theme_park"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}); nwr["leisure"="amusement_arcade"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  dunkin: `nwr["name"~"Dunkin",i](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  starbucks: `nwr["name"~"Starbucks",i](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  cvs: `nwr["name"~"CVS",i](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  mcdonalds: `nwr["name"~"McDonald",i](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  gasStations: `nwr["amenity"="fuel"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});`,
  bodiesOfWater: `(
    way["natural"~"^(water|bay)$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    relation["natural"~"^(water|bay)$"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    way["waterway"="river"]["name"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  );`,
};

async function overpassRaw(query){
  for(const url of OVERPASS_ENDPOINTS){
    try{
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Jetlag-MBTA-POI-Generator/1.0',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if(!res.ok) continue;
      const text = await res.text();
      try{
        return JSON.parse(text);
      }catch(err){
        continue;
      }
    }catch(err){}
  }
  throw new Error('All Overpass endpoints failed');
}

async function sleep(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeCenterElements(elements, fallbackName){
  return (elements || [])
    .map(el => ({
      name: el.tags?.name || fallbackName,
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
    }))
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function simplifyLineCoords(coords, tolerance = 0.0003){
  if(!Array.isArray(coords) || coords.length < 3) return coords || [];
  const simplified = [coords[0]];
  let last = coords[0];
  for(let i = 1; i < coords.length - 1; i++){
    const point = coords[i];
    if(Math.abs(point[0] - last[0]) >= tolerance || Math.abs(point[1] - last[1]) >= tolerance){
      simplified.push(point);
      last = point;
    }
  }
  simplified.push(coords[coords.length - 1]);
  return simplified;
}

function segmentKey(coords){
  const first = coords[0];
  const last = coords[coords.length - 1];
  const a = `${first[0].toFixed(4)},${first[1].toFixed(4)}`;
  const b = `${last[0].toFixed(4)},${last[1].toFixed(4)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildMergedMultiLineFeature(elements, fallbackName, tolerance = 0.001){
  const segments = [];
  const seen = new Set();

  for(const el of elements || []){
    if(el.type !== 'relation' || !Array.isArray(el.members)) continue;
    for(const member of el.members || []){
      if(member.type !== 'way' || !Array.isArray(member.geometry) || member.geometry.length < 2) continue;
      const coords = simplifyLineCoords(
        member.geometry.map(point => [point.lon, point.lat]),
        tolerance
      );
      if(coords.length < 2) continue;
      const key = segmentKey(coords);
      if(seen.has(key)) continue;
      seen.add(key);
      segments.push(coords);
    }
  }

  if(!segments.length) return [];
  return [{
    name: fallbackName,
    geometry: {
      type: 'MultiLineString',
      coordinates: segments,
    },
  }];
}

async function fetchCategory(name, body, outMode = 'center', fallbackName = 'POI'){
  const query = `[out:json][timeout:45];(${body});out ${outMode} 1000;`;
  console.log(`Fetching ${name}...`);
  const data = await overpassRaw(query);
  return normalizeCenterElements(data.elements, fallbackName);
}

async function fetchAmtrakLines(){
  const bbox = {south: 41.0, west: -72.0, north: 43.5, east: -70.0};
  const query = `[out:json][timeout:60];(
    relation["route"="train"]["operator"~"Amtrak",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    relation["route"="train"]["name"~"Downeaster|Northeast Corridor|NEC|Acela|Regional",i](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  );out geom;`;
  console.log('Fetching amtrakLines...');
  const data = await overpassRaw(query);
  return buildMergedMultiLineFeature(data.elements, 'Amtrak track');
}

async function loadExistingPayload(){
  try{
    const raw = await fs.readFile(OUTPUT, 'utf8');
    return JSON.parse(raw);
  }catch(err){
    return null;
  }
}

async function writePayload(payload){
  await fs.mkdir(path.dirname(OUTPUT), {recursive:true});
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main(){
  const requested = new Set(process.argv.slice(2));
  const existing = await loadExistingPayload();
  const payload = existing || {
    generatedAt: new Date().toISOString(),
    bbox: BBOX,
  };
  payload.generatedAt = new Date().toISOString();
  payload.bbox = BBOX;
  delete payload.seaLevel;

  for(const [name, body] of Object.entries(CATEGORY_QUERIES)){
    if(requested.size && !requested.has(name)) continue;
    if(Array.isArray(payload[name]) && payload[name].length && !requested.has(name)){
      console.log(`Skipping ${name} (cached)`);
      continue;
    }
    payload[name] = await fetchCategory(name, body, 'center', name);
    await writePayload(payload);
    await sleep(REQUEST_DELAY_MS);
  }

  if(!requested.size || requested.has('amtrakLines')){
    if(!Array.isArray(payload.amtrakLines) || !payload.amtrakLines.length || requested.has('amtrakLines')){
      payload.amtrakLines = await fetchAmtrakLines();
      await writePayload(payload);
      await sleep(REQUEST_DELAY_MS);
    } else {
      console.log('Skipping amtrakLines (cached)');
    }
  }

  if(!requested.size || requested.has('coastline')){
    if(!Array.isArray(payload.coastline) || !payload.coastline.length || requested.has('coastline')){
      console.log('Fetching coastline...');
      const coastlineWays = await fetchCoastlineWays(overpassRaw, BBOX);
      payload.coastline = densifyCoastlineWays(coastlineWays, 0.5, 'Coastline');
      await writePayload(payload);
    } else {
      console.log('Skipping coastline (cached)');
    }
  }

  await writePayload(payload);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
