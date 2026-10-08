const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const t=require('@turf/turf');
const turf={...t,union:(a,b)=>t.union(t.featureCollection([a,b])),intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),difference:(a,b)=>t.difference(t.featureCollection([a,b]))};
function game(city){
 const element={style:{},classList:{add(){},remove(){}}};
 const ctx=vm.createContext({console,turf,URLSearchParams,URL,setTimeout:()=>0,clearTimeout(){},window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},document:{getElementById:()=>element},navigator:{}});
 for(const f of ['chicago-service.js','00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),ctx);
 const run=s=>vm.runInContext(s,ctx);
 run(`var messages=[];toast=message=>messages.push(message);var station={name:'Station',lat:ACTIVE_CITY.center[0],lng:ACTIVE_CITY.center[1],lines:new Set(['Red'])};stopLineMap.a=station;validZone=buildHideRadiusZone();
 var elevationQuestion={id:'elevation-clue',type:'measure',center:{lat:station.lat,lng:station.lng},category:'elevation',mode:'elevation',seeker_elevation_ft:100,seeker_elevation_m:30.48,answer:'higher'};
 var grid={latitudes:[station.lat-1,station.lat+1],longitudes:[station.lng-1,station.lng+1],values:[[0,0],[0,0]]};
 var release;loadElevationData=()=>new Promise(resolve=>{release=value=>{preloadedData.elevation=value;resolve(value)}});
 var log={version:4,...cityMetadata(),hide_radius_miles:.25,constraints:[elevationQuestion]};`);
 return {ctx,run};
}
for(const city of ['boston','chicago']){
 test(`${city}: elevation import awaits its grid, applies the clue, and leaves live state intact`,async()=>{
  const g=game(city),before=g.run('JSON.stringify({validZone,constraints,hideRadiusMi})');
  let done=false;const pending=g.run('prepareQuestionLog(log)').then(value=>{done=true;return value});
  await Promise.resolve();assert.equal(done,false,'must not accept a clue while geography is unresolved');
  assert.equal(g.run('JSON.stringify({validZone,constraints,hideRadiusMi})'),before);
  g.run('release(grid)');const prepared=await pending;
  assert.equal(turf.area(prepared.zone),0,'all terrain is below the saved threshold');
  assert.equal(g.run('JSON.stringify({validZone,constraints,hideRadiusMi})'),before);
 });
 test(`${city}: failed elevation import is atomic and retry can succeed`,async()=>{
  const g=game(city),before=g.run('JSON.stringify({validZone,constraints,hideRadiusMi})');
  const failed=g.run('prepareQuestionLog(log)');g.run('release(null)');
  await assert.rejects(failed,/Elevation geography could not be loaded/);
  assert.equal(g.run('JSON.stringify({validZone,constraints,hideRadiusMi})'),before);
  const retry=g.run('prepareQuestionLog(log)');g.run('release(grid)');
  assert.equal(turf.area((await retry).zone),0);
 });
 test(`${city}: resume awaits elevation before restoring and recomputing`,async()=>{
  const g=game(city);g.run(`mbdataReady=true;var saved={hideRadiusMi:.25,gameMode:'hider',validZone:cloneGeo(validZone),constraints:[elevationQuestion]};loadSave=()=>saved;
    validateSavedCityQuestions=()=>{};applyHideRadiusVisuals=()=>{};applyGameMode=()=>{};drawHideRadiusVisuals=()=>{};renderZone=()=>{};renderLog=()=>{};saveGame=()=>{};switchTab=()=>{};`);
  const before=g.run('JSON.stringify({validZone,constraints})');
  const failed=g.run('resumeGame()');assert.equal(g.run('JSON.stringify({validZone,constraints})'),before);
  g.run('release(null)');await failed;
  assert.equal(g.run('JSON.stringify({validZone,constraints})'),before,'failed readiness must not mutate the active game');
  assert.match(g.run('messages.at(-1)'),/Elevation geography/);
  const pending=g.run('resumeGame()');assert.equal(g.run('JSON.stringify({validZone,constraints})'),before);
  g.run('release(grid)');await pending;
  assert.equal(g.run('turf.area(validZone)'),0);assert.equal(g.run('constraints.length'),1);
 });
}
