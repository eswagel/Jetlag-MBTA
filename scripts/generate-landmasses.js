#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const {point, lineString, featureCollection} = require('@turf/helpers');
const {buffer} = require('@turf/buffer');
const {union} = require('@turf/union');
const {flatten} = require('@turf/flatten');

const ROOT = path.resolve(__dirname, '..');
const BOUNDARIES = path.join(ROOT, 'data', 'boundaries.json');
const MBTA_DATA = path.join(ROOT, 'data', 'mbta-data.json');
const OUTPUT = path.join(ROOT, 'data', 'landmasses.json');

const REGIONS = [
  {id: 0, name: 'Across the Mystic'},
  {id: 1, name: 'Across the Charles'},
  {id: 2, name: 'Across the Neponset'},
  {id: 3, name: 'Mainland Boston'},
];

const CHARLES_LINE = [[-71.173, 42.363], [-70.978, 42.359]];
const MYSTIC_LINE = [[-71.084, 42.391], [-70.957, 42.366]];
const NEPONSET_LINE = [[-71.151, 42.287], [-70.983, 42.306]];

const EAST_BOSTON_AND_NORTH = new Set([
  'place-welln', 'place-mlmnl', 'place-ogmnl',
  'place-mvbcl', 'place-aport', 'place-wimnl', 'place-orhte',
  'place-sdmnl', 'place-bmmnl', 'place-rbmnl', 'place-wondl',
]);

async function readJSON(file){
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function flattenPolygons(feature){
  try{
    return (flatten(feature).features || []).filter(f => f.geometry?.type === 'Polygon');
  }catch{
    return [];
  }
}

function unionAll(features){
  if(!features.length) return null;
  let current = features[0];
  for(let i = 1; i < features.length; i++){
    const next = union(featureCollection([current, features[i]]));
    if(next) current = next;
  }
  return current;
}

function sideOfLine(stop, line){
  const [a, b] = line;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const vx = x2 - x1;
  const vy = y2 - y1;
  const tRaw = ((stop.lng - x1) * vx + (stop.lat - y1) * vy) / ((vx * vx + vy * vy) || 1);
  const t = Math.max(0, Math.min(1, tRaw));
  const px = x1 + t * vx;
  const py = y1 + t * vy;
  return (vx * (stop.lat - py)) - (vy * (stop.lng - px));
}

function classifyStop(stop){
  const northOfCharles = sideOfLine(stop, CHARLES_LINE) > 0;
  const northOfMystic = sideOfLine(stop, MYSTIC_LINE) > 0;
  const southOfNeponset = sideOfLine(stop, NEPONSET_LINE) < 0;

  if(southOfNeponset) return 2;
  if(northOfCharles){
    if(northOfMystic || EAST_BOSTON_AND_NORTH.has(stop.id)) return 0;
    return 1;
  }
  return 3;
}

async function main(){
  const [boundaryData, mbtaData] = await Promise.all([readJSON(BOUNDARIES), readJSON(MBTA_DATA)]);

  const cityFeatures = (boundaryData.cities || [])
    .filter(city => city.geometry)
    .map(city => city.geometry.type === 'Feature'
      ? city.geometry
      : {type: 'Feature', properties: {name: city.name}, geometry: city.geometry});

  const stopsById = new Map();
  for(const line of mbtaData.lines || []){
    for(const stop of line.stops || []){
      if(!stopsById.has(stop.id)) stopsById.set(stop.id, stop);
    }
  }
  const stops = [...stopsById.values()];

  const assignments = {};
  const regionStops = new Map(REGIONS.map(r => [r.id, []]));
  for(const stop of stops){
    const regionId = classifyStop(stop);
    assignments[stop.id] = regionId;
    regionStops.get(regionId).push(stop);
  }

  const pieces = REGIONS.map(region => {
    const stopPoints = regionStops.get(region.id).map(stop => point([stop.lng, stop.lat]));
    const cloud = stopPoints.length ? buffer(featureCollection(stopPoints), 1.3, {units: 'kilometers'}) : null;
    const cloudUnion = cloud ? unionAll(flattenPolygons(cloud)) : null;
    const geometry = (cloudUnion || unionAll(cityFeatures)).geometry;

    return {id: region.id, name: region.name, geometry};
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    pieces,
    stops: assignments,
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload) + '\n', 'utf8');
  console.log(`Wrote ${OUTPUT}`);
  const counts = {};
  for(const id of Object.values(assignments)) counts[id] = (counts[id] || 0) + 1;
  console.log('Region stop counts:', counts);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
