#!/usr/bin/env node
// Offline regeneration from pinned FRA/BTS source geometry. No station-to-station chords.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const turf=require('@turf/turf');
const {clipLineSegments}=require('./lib/line-geometry.cjs');
const ROOT=path.resolve(__dirname,'..');
const NORMALIZATION=require('../data/chicago/sources/amtrak-route-normalization.json');
const CLIP=[-88.5,41.1,-87,42.6];
function build(source){
  if(source.type!=='FeatureCollection'||source.exceededTransferLimit||!source.features?.length) throw Error('Incomplete Amtrak source');
  const aliases=new Map(NORMALIZATION.aliases.map(alias=>[alias.sourceName,alias]));
  const built=source.features.map(f=>{
    if(!['LineString','MultiLineString'].includes(f.geometry?.type))throw Error('Non-track Amtrak geometry');
    const segments=clipLineSegments(f.geometry,CLIP,turf);
    if(!segments.length)return null;
    const alias=aliases.get(f.properties.name);
    return {type:'Feature',properties:{name:alias?.displayName || f.properties.name,sourceNames:[f.properties.name],sourceIds:[f.properties.OBJECTID],sourceId:f.properties.OBJECTID,routeUrl:f.properties.ROUTE_URL,...(alias?{nameNormalization:alias}: {})},geometry:{type:'MultiLineString',coordinates:segments}};
  }).filter(Boolean);
  // Only merge known aliases with identical geometry. Different tracks always survive.
  const groups=new Map();
  for(const feature of built){
    const key=feature.properties.name+'|'+JSON.stringify(feature.geometry);
    const existing=groups.get(key);
    if(existing){
      existing.properties.sourceNames=[...new Set([...existing.properties.sourceNames,...feature.properties.sourceNames])];
      existing.properties.sourceIds=[...new Set([...existing.properties.sourceIds,...feature.properties.sourceIds])];
      if(feature.properties.nameNormalization) existing.properties.nameNormalization=feature.properties.nameNormalization;
      if(feature.properties.sourceNames.includes(feature.properties.name)){
        existing.properties.routeUrl=feature.properties.routeUrl;
        existing.properties.sourceId=feature.properties.sourceId;
      }
    }else groups.set(key,feature);
  }
  return [...groups.values()];
}
function main(){
  const dir=path.join(ROOT,'data/chicago');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'sources/amtrak-routes-manifest.json')));
  const raw=zlib.gunzipSync(fs.readFileSync(path.join(dir,'sources/amtrak-routes.json.gz')));
  if(crypto.createHash('sha256').update(raw).digest('hex')!==manifest.sha256)throw Error('Amtrak snapshot hash mismatch');
  const payload=JSON.parse(fs.readFileSync(path.join(dir,'pois.json')));
  payload.amtrakLines=build(JSON.parse(raw));
  payload.amtrakSource={...manifest,nameNormalizationVersion:NORMALIZATION.version,nameNormalizationSource:'data/chicago/sources/amtrak-route-normalization.json',clipBBox:CLIP,definition:'FRA/BTS NTAD Amtrak route centerlines derived from the physical rail network, at 1:24,000 or better; not station chords or all freight tracks.'};
  payload.available=[...new Set([...(payload.available||[]),'amtrakLines'])];
  payload.unavailable=(payload.unavailable||[]).filter(k=>k!=='amtrakLines');
  fs.writeFileSync(path.join(dir,'pois.json'),JSON.stringify(payload)+'\n');
  console.log(`Saved ${payload.amtrakLines.length} Amtrak route geometries`);
}
if(require.main===module)main();
module.exports={build,CLIP};
