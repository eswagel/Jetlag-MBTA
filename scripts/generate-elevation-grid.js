#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const OUTPUT = path.resolve(__dirname, '..', 'data', 'elevation-grid.json');
const BBOX = {south: 42.18, west: -71.55, north: 42.67, east: -70.85};
const LAT_STEP = 0.025;
const LNG_STEP = 0.025;
const CONCURRENCY = 12;
const MAX_RETRIES = 3;
const REQUEST_DELAY_MS = 80;

function frange(start, end, step){
  const out = [];
  for(let value = start; value <= end + 1e-9; value += step){
    out.push(Number(value.toFixed(6)));
  }
  return out;
}

async function sleep(ms){
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchElevationFeet(lat, lng){
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  const res = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const value = Number(data?.value);
  if(!Number.isFinite(value)) throw new Error('Invalid elevation response');
  return value;
}

async function fetchElevationFeetWithRetry(lat, lng){
  let lastError = null;
  for(let attempt = 1; attempt <= MAX_RETRIES; attempt++){
    try{
      return await fetchElevationFeet(lat, lng);
    }catch(err){
      lastError = err;
      await sleep(REQUEST_DELAY_MS * attempt);
    }
  }
  throw lastError || new Error('Elevation lookup failed');
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
  const latitudes = frange(BBOX.south, BBOX.north, LAT_STEP);
  const longitudes = frange(BBOX.west, BBOX.east, LNG_STEP);
  const existing = await loadExistingPayload();
  const existingValues = existing?.values || [];
  const values = latitudes.map((lat, rowIdx) =>
    longitudes.map((lng, colIdx) => {
      const existingValue = existingValues?.[rowIdx]?.[colIdx];
      return Number.isFinite(existingValue) ? existingValue : null;
    })
  );

  const tasks = [];
  latitudes.forEach((lat, rowIdx) => {
    longitudes.forEach((lng, colIdx) => {
      if(Number.isFinite(values[rowIdx][colIdx])) return;
      tasks.push({lat, lng, rowIdx, colIdx});
    });
  });

  console.log(`Elevation grid: ${latitudes.length} rows x ${longitudes.length} cols (${latitudes.length * longitudes.length} points)`);
  console.log(`Need to fetch ${tasks.length} missing points`);

  let completed = 0;
  async function worker(){
    while(tasks.length){
      const task = tasks.shift();
      if(!task) return;
      const {lat, lng, rowIdx, colIdx} = task;
      const value = await fetchElevationFeetWithRetry(lat, lng);
      values[rowIdx][colIdx] = Number(value.toFixed(3));
      completed += 1;
      if(completed % 25 === 0 || completed === tasks.length){
        console.log(`Fetched ${completed} points`);
      }
    }
  }

  const workers = Array.from({length: Math.min(CONCURRENCY, Math.max(tasks.length, 1))}, () => worker());
  await Promise.all(workers);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'USGS EPQS',
    units: 'feet',
    bbox: BBOX,
    latStep: LAT_STEP,
    lngStep: LNG_STEP,
    latitudes,
    longitudes,
    values,
  };

  await writePayload(payload);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
