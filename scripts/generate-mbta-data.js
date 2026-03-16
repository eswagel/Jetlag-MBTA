#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const BASE = 'https://api-v3.mbta.com';
const OUTPUT = path.resolve(__dirname, '..', 'data', 'mbta-data.json');
const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};

const GAME_LINES = [
  { id:'Red-Ashmont',   label:'Red · Ashmont',   color:'#DA291C', weight:5, routeId:'Red', branchKeyword:'Ashmont' },
  { id:'Red-Braintree', label:'Red · Braintree', color:'#DA291C', weight:5, routeId:'Red', branchKeyword:'Braintree' },
  { id:'Orange',        label:'Orange Line',     color:'#ED8B00', weight:5, routeId:'Orange' },
  { id:'Blue',          label:'Blue Line',       color:'#003DA5', weight:5, routeId:'Blue' },
  { id:'Green-B',       label:'Green Line · B',  color:'#00843D', weight:4, routeId:'Green-B' },
  { id:'Green-C',       label:'Green Line · C',  color:'#00843D', weight:4, routeId:'Green-C' },
  { id:'Green-D',       label:'Green Line · D',  color:'#00843D', weight:4, routeId:'Green-D' },
  { id:'Green-E',       label:'Green Line · E',  color:'#00843D', weight:4, routeId:'Green-E' },
  { id:'Mattapan',      label:'Mattapan Line',   color:'#DA291C', weight:4, routeId:'Mattapan' },
];

const ASHMONT_ONLY = new Set(['place-shmnl','place-fldcr','place-smmnl','place-asmnl']);
const BRAINTREE_ONLY = new Set(['place-nqncy','place-wlsta','place-qnctr','place-qamnl','place-brntn']);

function decodePolyline(str){
  let idx = 0;
  let lat = 0;
  let lng = 0;
  const out = [];
  while(idx < str.length){
    let b;
    let shift = 0;
    let res = 0;
    do{
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    }while(b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);

    shift = 0;
    res = 0;
    do{
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    }while(b >= 0x20);
    lng += (res & 1) ? ~(res >> 1) : (res >> 1);

    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

async function fetchJSON(url){
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Jetlag-MBTA-Data-Generator/1.0',
    },
  });
  if(!res.ok){
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchLineShape(line){
  const shapeData = await fetchJSON(`${BASE}/shapes?filter[route]=${line.routeId}&fields[shape]=polyline`);

  if(line.branchKeyword){
    const keyword = line.branchKeyword.toLowerCase();
    const allDecoded = (shapeData.data || [])
      .map(shape => ({
        id: shape.id,
        coords: decodePolyline(shape.attributes.polyline),
      }))
      .filter(shape => shape.coords.length > 1);

    let match = allDecoded.find(shape => shape.id.toLowerCase().includes(keyword));
    if(!match){
      const termLat = line.branchKeyword === 'Ashmont' ? 42.284 : 42.207;
      match = allDecoded.reduce((best, shape) => {
        const endLat = shape.coords[shape.coords.length - 1][0];
        const score = -Math.abs(endLat - termLat);
        return (!best || score > best.score) ? {...shape, score} : best;
      }, null);
    }
    return match ? match.coords : [];
  }

  const sorted = (shapeData.data || [])
    .map(shape => decodePolyline(shape.attributes.polyline))
    .filter(coords => coords.length > 1)
    .sort((a, b) => b.length - a.length);
  return sorted[0] || [];
}

async function fetchLineStops(line){
  const stopData = await fetchJSON(`${BASE}/stops?filter[route]=${line.routeId}&fields[stop]=name,latitude,longitude`);
  return (stopData.data || [])
    .map(stop => ({
      id: stop.id,
      name: stop.attributes?.name,
      lat: stop.attributes?.latitude,
      lng: stop.attributes?.longitude,
    }))
    .filter(stop => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
    .filter(stop => {
      if(line.branchKeyword === 'Ashmont') return !BRAINTREE_ONLY.has(stop.id);
      if(line.branchKeyword === 'Braintree') return !ASHMONT_ONLY.has(stop.id);
      return true;
    });
}

async function fetchCommuterRail(){
  const data = await fetchJSON(`${BASE}/stops?filter[route_type]=2&fields[stop]=name,latitude,longitude&page[size]=500&include=parent_station`);
  const seen = new Set();
  return (data.data || [])
    .map(stop => ({
      id: stop.id,
      parentId: stop.relationships?.parent_station?.data?.id || null,
      name: stop.attributes?.name,
      lat: stop.attributes?.latitude,
      lng: stop.attributes?.longitude,
    }))
    .filter(stop =>
      stop.name &&
      Number.isFinite(stop.lat) &&
      Number.isFinite(stop.lng) &&
      stop.lat >= T_BBOX.minLat &&
      stop.lat <= T_BBOX.maxLat &&
      stop.lng >= T_BBOX.minLng &&
      stop.lng <= T_BBOX.maxLng &&
      (!seen.has(stop.name) && seen.add(stop.name))
    );
}

async function main(){
  console.log('Fetching MBTA network data...');
  const lines = [];
  for(const line of GAME_LINES){
    console.log(`  ${line.id}`);
    const [shapePath, stops] = await Promise.all([
      fetchLineShape(line),
      fetchLineStops(line),
    ]);
    lines.push({
      id: line.id,
      label: line.label,
      color: line.color,
      weight: line.weight,
      routeId: line.routeId,
      branchKeyword: line.branchKeyword || null,
      shapePath,
      stops,
    });
  }

  console.log('Fetching commuter rail stops...');
  const commuterRail = await fetchCommuterRail();

  const payload = {
    generatedAt: new Date().toISOString(),
    bbox: {south: T_BBOX.minLat, north: T_BBOX.maxLat, west: T_BBOX.minLng, east: T_BBOX.maxLng},
    lines,
    commuterRail,
  };

  await fs.mkdir(path.dirname(OUTPUT), {recursive:true});
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
