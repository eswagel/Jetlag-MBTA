#!/usr/bin/env node
// Offline regeneration from pinned FRA/BTS source geometry. No station-to-station chords.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const turf=require('@turf/turf');
const {clipLineSegments}=require('./lib/line-geometry.cjs');
const ROOT=path.resolve(__dirname,'..');
const CLIP=[-88.5,41.1,-87,42.6];
function build(source){
  if(source.type!=='FeatureCollection'||source.exceededTransferLimit||!source.features?.length) throw Error('Incomplete Amtrak source');
  return source.features.map(f=>{
    if(!['LineString','MultiLineString'].includes(f.geometry?.type))throw Error('Non-track Amtrak geometry');
    const segments=clipLineSegments(f.geometry,CLIP,turf);
    if(!segments.length)return null;
    return {type:'Feature',properties:{name:f.properties.name,sourceId:f.properties.OBJECTID,routeUrl:f.properties.ROUTE_URL},geometry:{type:'MultiLineString',coordinates:segments}};
  }).filter(Boolean);
}
function main(){
  const dir=path.join(ROOT,'data/chicago');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'sources/amtrak-routes-manifest.json')));
  const raw=zlib.gunzipSync(fs.readFileSync(path.join(dir,'sources/amtrak-routes.json.gz')));
  if(crypto.createHash('sha256').update(raw).digest('hex')!==manifest.sha256)throw Error('Amtrak snapshot hash mismatch');
  const payload=JSON.parse(fs.readFileSync(path.join(dir,'pois.json')));
  payload.amtrakLines=build(JSON.parse(raw));
  payload.amtrakSource={...manifest,clipBBox:CLIP,definition:'FRA/BTS NTAD Amtrak route centerlines derived from the physical rail network, at 1:24,000 or better; not station chords or all freight tracks.'};
  payload.available=[...new Set([...(payload.available||[]),'amtrakLines'])];
  payload.unavailable=(payload.unavailable||[]).filter(k=>k!=='amtrakLines');
  fs.writeFileSync(path.join(dir,'pois.json'),JSON.stringify(payload)+'\n');
  console.log(`Saved ${payload.amtrakLines.length} Amtrak route geometries`);
}
if(require.main===module)main();
module.exports={build,CLIP};
