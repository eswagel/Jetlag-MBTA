#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const {point, polygon, feature, lineString, featureCollection} = require('@turf/helpers');
const {flatten} = require('@turf/flatten');
const {simplify} = require('@turf/simplify');
const {booleanPointInPolygon} = require('@turf/boolean-point-in-polygon');
const {booleanIntersects} = require('@turf/boolean-intersects');
const {difference} = require('@turf/difference');
const {area} = require('@turf/area');
const {buffer} = require('@turf/buffer');
const {fetchCoastlineWays, buildLandFacesFromCoastlineWays} = require('./lib/shoreline');

const OUTPUT = path.resolve(__dirname, '..', 'data', 'landmasses.json');
const CACHE_DIR = path.resolve(__dirname, '..', 'data', '_cache', 'landmasses-v1');
const MBTA_DATA = path.resolve(__dirname, '..', 'data', 'mbta-data.json');
const BBOX = {south: 42.18, west: -71.55, north: 42.67, east: -70.85};
const MIN_WATER_AREA_SQM = 15000;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassRaw(query){
  for(const url of OVERPASS_ENDPOINTS){
    try{
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Jetlag-MBTA-Landmass-Generator/1.0',
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

async function readJSONIfExists(filePath){
  try{
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  }catch(err){
    return null;
  }
}

async function writeJSON(filePath, value){
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
    const container = polygons.find(poly => pointInRing(hole[0], poly.outer));
    if(container) container.holes.push(hole);
  }

  const coords = polygons.map(poly => [poly.outer, ...poly.holes]);
  if(coords.length === 1) return {type: 'Polygon', coordinates: coords[0]};
  return {type: 'MultiPolygon', coordinates: coords};
}

function flattenPolygonFeature(feature){
  if(!feature) return [];
  try{
    const fc = flatten(feature);
    return (fc.features || []).filter(f => f.geometry?.type === 'Polygon');
  }catch(err){
    return feature.geometry?.type === 'Polygon' ? [feature] : [];
  }
}

function simplifyFeature(feature, tolerance = 0.0004){
  try{
    return simplify(feature, {tolerance, highQuality: false, mutate: false});
  }catch(err){
    return feature;
  }
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

async function fetchWaterRelationsAndWays(){
  const query = `[out:json][timeout:120];
    (
      way["natural"~"^(water|bay)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      relation["natural"~"^(water|bay)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way["waterway"="river"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      way["waterway"="riverbank"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
      relation["waterway"="riverbank"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
    );
    out geom;`;
  const data = await overpassRaw(query);
  return data.elements || [];
}

function buildWaterPolygons(elements){
  const out = [];

  for(const el of elements){
    if(el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2){
      const coords = el.geometry.map(point => [point.lon, point.lat]);
      const isRiverLine = el.tags?.waterway === 'river' && !sameCoord(coords[0], coords[coords.length - 1]);
      if(isRiverLine){
        try{
          const buffered = buffer(lineString(coords, {name: el.tags?.name || 'river'}), 0.03, {units: 'kilometers'});
          out.push(...flattenPolygonFeature(buffered));
        }catch(err){}
        continue;
      }

      const ring = closeRing(coords);
      if(ring.length >= 4){
        out.push(polygon([ring], {name: el.tags?.name || 'water'}));
      }
      continue;
    }

    if(el.type === 'relation'){
      const geometry = relationToGeometry(el);
      if(!geometry) continue;
      const waterFeature = feature(geometry, {name: el.tags?.name || 'water'});
      out.push(...flattenPolygonFeature(waterFeature));
    }
  }

  return out.filter(poly => {
    try{
      return area(poly) >= MIN_WATER_AREA_SQM;
    }catch(err){
      return false;
    }
  });
}

function subtractWaterFromLand(landFaces, waterPolygons){
  let pieces = landFaces.slice();

  for(const water of waterPolygons){
    const next = [];
    for(const piece of pieces){
      let result = piece;
      try{
        if(booleanIntersects(piece, water)){
          result = difference(featureCollection([piece, water]));
        }
      }catch(err){}

      if(!result){
        continue;
      }
      next.push(...flattenPolygonFeature(result));
    }
    pieces = next.length ? next : pieces;
  }

  return pieces
    .map(piece => simplifyFeature(piece))
    .filter(piece => area(piece) > 1000);
}

function assignStopsToPieces(stops, pieces){
  const stopIndex = {};
  const pieceStops = pieces.map(() => []);

  stops.forEach(stop => {
    const pt = point([stop.lng, stop.lat]);
    const idx = pieces.findIndex(piece => {
      try{
        return booleanPointInPolygon(pt, piece);
      }catch(err){
        return false;
      }
    });
    if(idx >= 0){
      stopIndex[stop.id] = idx;
      pieceStops[idx].push(stop.name);
    }
  });

  return {stopIndex, pieceStops};
}

async function main(){
  console.log('Loading MBTA stops...');
  const stops = await loadStops();
  console.log(`Loaded ${stops.length} unique stops`);

  const coastlineCache = path.join(CACHE_DIR, 'coastline-ways.json');
  let coastlineWays = await readJSONIfExists(coastlineCache);
  if(coastlineWays){
    console.log(`Loaded ${coastlineWays.length} cached coastline ways`);
  } else {
    console.log('Fetching coastline ways...');
    coastlineWays = await fetchCoastlineWays(overpassRaw, BBOX);
    console.log(`Fetched ${coastlineWays.length} coastline ways`);
    await writeJSON(coastlineCache, coastlineWays);
  }

  const landFaceCache = path.join(CACHE_DIR, 'land-faces.json');
  let landFaces = await readJSONIfExists(landFaceCache);
  if(landFaces){
    console.log(`Loaded ${landFaces.length} cached coastline-derived land faces`);
  } else {
    console.log('Building coastal land faces...');
    landFaces = buildLandFacesFromCoastlineWays(coastlineWays, BBOX, stops);
    console.log(`Kept ${landFaces.length} coastline-derived land faces`);
    await writeJSON(landFaceCache, landFaces);
  }
  if(!landFaces.length){
    throw new Error('No coastline-derived land faces contained MBTA stops');
  }

  const waterCache = path.join(CACHE_DIR, 'water-elements.json');
  let waterElements = await readJSONIfExists(waterCache);
  if(waterElements){
    console.log(`Loaded ${waterElements.length} cached water elements`);
  } else {
    console.log('Fetching water polygons...');
    waterElements = await fetchWaterRelationsAndWays();
    console.log(`Fetched ${waterElements.length} water elements`);
    await writeJSON(waterCache, waterElements);
  }
  const waterPolygons = buildWaterPolygons(waterElements);
  console.log(`Built ${waterPolygons.length} water polygons`);

  const rawPieceCache = path.join(CACHE_DIR, 'raw-pieces-v2.json');
  let rawPieces = await readJSONIfExists(rawPieceCache);
  if(rawPieces){
    console.log(`Loaded ${rawPieces.length} cached raw land pieces`);
  } else {
    console.log('Subtracting water from land faces...');
    rawPieces = subtractWaterFromLand(landFaces, waterPolygons);
    console.log(`Built ${rawPieces.length} raw land pieces`);
    await writeJSON(rawPieceCache, rawPieces);
  }

  const {stopIndex, pieceStops} = assignStopsToPieces(stops, rawPieces);
  const usedPieceIds = [...new Set(Object.values(stopIndex))].sort((a, b) => a - b);
  const usedPieces = usedPieceIds.map((oldIdx, newIdx) => {
    const names = pieceStops[oldIdx] || [];
    const label = names.includes('Airport') || names.includes('Maverick')
      ? 'East Boston'
      : `Landmass ${newIdx + 1}`;
    return {
      oldIdx,
      piece: {
        id: newIdx,
        name: label,
        geometry: rawPieces[oldIdx].geometry,
      },
    };
  });

  const remappedStops = {};
  Object.entries(stopIndex).forEach(([stopId, oldIdx]) => {
    const mapped = usedPieces.find(entry => entry.oldIdx === oldIdx);
    if(mapped) remappedStops[stopId] = mapped.piece.id;
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    pieces: usedPieces.map(entry => entry.piece),
    stops: remappedStops,
  };

  await fs.mkdir(path.dirname(OUTPUT), {recursive: true});
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
