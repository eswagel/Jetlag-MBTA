const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function app(city='boston', storage=new Map(), lineIds){
  const nodes = new Map();
  const url = new URL('https://example.com/');
  url.searchParams.set('city',city);
  if(lineIds !== undefined) url.searchParams.set('lines',lineIds);
  const context = vm.createContext({
    URLSearchParams, URL, console, setTimeout, clearTimeout,
    window:{location:url},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    document:{getElementById:id=>nodes.get(id)||null},
    turf:{polygon:coordinates=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates}})},
  });
  for(const file of ['00-cities.js','01-core.js','02-map.js']) vm.runInContext(fs.readFileSync(path.join(root,'assets/js/app',file),'utf8'),context);
  return {run:source=>vm.runInContext(source,context),context,nodes,storage};
}
test('city profiles choose distinct geography and all files stay city scoped',()=>{
  const b=app(),c=app('chicago');
  assert.equal(b.run('ACTIVE_CITY.id'),'boston');
  assert.equal(c.run('ACTIVE_CITY.timezone'),'America/Chicago');
  assert.equal(app('unknown').run('ACTIVE_CITY.id'),'boston');
  assert.equal(c.run('Object.values(DATA_FILES).every(path=>path.startsWith("data/chicago/"))'),true);
  assert.equal(c.run('INIT_POLY.geometry.coordinates[0][0][0]'),-88);
});
test('saves remain isolated and legacy Boston saves never load into Chicago',()=>{
  const storage=new Map(),b=app('boston',storage),c=app('chicago',storage);
  b.run('saveGame()'); c.run('saveGame()');
  assert.equal(JSON.parse(storage.get('jetlag_boston_save')).city_id,'boston');
  assert.equal(JSON.parse(storage.get('jetlag_chicago_save')).city_id,'chicago');
  c.run('clearSave()'); assert.ok(storage.has('jetlag_boston_save'));
  storage.set('jetlag_mbta_save',JSON.stringify({v:2,constraints:[],validZone:{}}));
  storage.delete('jetlag_boston_save');
  assert.equal(b.run('loadSave().v'),2); assert.equal(c.run('loadSave()'),null);
  b.run('clearSave()');assert.equal(storage.has('jetlag_mbta_save'),false);
});
test('mismatched cities and dataset versions are rejected',()=>{
  const c=app('chicago');
  assert.equal(c.run('cityCompatibilityError(stampCityPayload({type:"radar"}))'),null);
  assert.match(c.run('cityCompatibilityError({city_id:"boston",dataset_version:"boston-v1"})'),/belongs/);
  assert.match(c.run('cityCompatibilityError({city_id:"chicago",dataset_version:"old"})'),/version/);
  assert.match(c.run('cityCompatibilityError({type:"radar"})'),/Legacy/);
});
test('unavailable Chicago transit disables start and never calls MBTA live service',async()=>{
  const a=app('chicago'); const requests=[];
  a.context.fetch=async url=>{requests.push(url);return {ok:false}};
  a.nodes.set('btn-start',{disabled:false});a.nodes.set('setup-status-text',{});
  await a.run('loadMBTAData()');
  assert.deepEqual(requests,['data/chicago/transit.json']);
  assert.equal(a.nodes.get('btn-start').disabled,true);
  assert.equal(a.run('mbdataReady'),false);
  assert.match(a.nodes.get('setup-status-text').textContent,/unavailable/);
});
test('empty transit never marks setup ready',()=>{
  const a=app('chicago'); a.nodes.set('btn-start',{disabled:false});
  a.run('finalizeMBTALoad(null)');
  assert.equal(a.run('mbdataReady'),false);assert.equal(a.nodes.get('btn-start').disabled,true);
});
test('scheduled Purple Express does not imply active station membership',()=>{
  const a=app('chicago');
  a.run('drawStopMarkers = ()=>{}; finalizeMBTALoad = ()=>{}; drawTransitRoutes = ()=>{}');
  a.run(`hydrateMBTAFromStatic({lines:[
    {id:'Purple',stops:[{id:'1',name:'A',lat:42,lng:-87.7}]},
    {id:'Purple-Express',stops:[{id:'1',name:'A',lat:42,lng:-87.7},{id:'2',name:'B',lat:41.9,lng:-87.7}]}
  ]},null)`);
  assert.equal(a.run('stopLineMap["1"].id'),'1');
  assert.equal(a.run('stopLineMap["1"].lines.has("Purple")'),true);
  assert.equal(a.run('stopLineMap["1"].lines.has("Purple-Express")'),false);
  assert.equal(a.run('stopLineMap["2"]'),undefined);
});
test('custom selection has canonical order and isolated saves and transfers',()=>{
  const storage = new Map();
  const standard = app('boston',storage);
  const custom = app('boston',storage,'Orange,Blue,Orange');
  const sameLines = app('boston',storage,'Blue,Orange');
  assert.deepEqual(Array.from(custom.run('enabledLineIds')),['Orange','Blue']);
  assert.equal(app('boston',storage,'').run('hasCustomLines'),false);
  assert.equal(app('boston',storage,'Orange,unknown').run('hasCustomLines'),false);
  standard.run('saveGame()');
  custom.run('saveGame()');
  assert.equal(storage.size,2);
  assert.deepEqual(Array.from(sameLines.run('loadSave().enabled_line_ids')),['Orange','Blue']);
  assert.equal(standard.run('loadSave().enabled_line_ids'),undefined);
  standard.context.packet = custom.run('stampCityPayload({type:"matching",category:"line"})');
  assert.match(standard.run('gameCompatibilityError(packet)'),/Transit line selections differ/);
  sameLines.context.packet = standard.context.packet;
  assert.equal(sameLines.run('gameCompatibilityError(packet)'),null);
  assert.match(custom.run('gameCompatibilityError(cityMetadata())'),/Transit line selections differ/);
  assert.equal(standard.run('gameCompatibilityError(cityMetadata())'),null);
  assert.match(custom.run('gameCompatibilityError({...cityMetadata(),enabled_line_ids:[]})'),/Transit line selections differ/);
});
test('transit hydration filters routes and station membership together',()=>{
  const a = app('chicago',new Map(),'Brown');
  a.run(`
    var renderedLineIds, renderedStops;
    drawTransitRoutes = lines => { renderedLineIds = lines.map(line=>line.id); };
    drawStopMarkers = stops => { renderedStops = stops; };
    finalizeMBTALoad = ()=>{};
    var shared = {id:'1', name:'Shared', lat:41.89, lng:-87.65};
    var blueOnly = {id:'2', name:'Blue', lat:41.91, lng:-87.66};
    var expressOnly = {id:'3', name:'Express', lat:41.9, lng:-87.67};
    hydrateMBTAFromStatic({lines:[
      {id:'Brown', stops:[shared]},
      {id:'Blue', stops:[shared,blueOnly]},
      {id:'Purple-Express', stops:[expressOnly]},
    ], commuterRail:[{id:'c',name:'Reference',lat:42,lng:-87.7}]}, null);
  `);
  assert.deepEqual(Array.from(a.run('renderedLineIds')),['Brown']);
  assert.deepEqual(Array.from(a.run('Object.keys(stopLineMap)')),['1']);
  assert.deepEqual(Array.from(a.run('stopLineMap["1"].lines')),['Brown']);
  assert.deepEqual(Array.from(a.run('renderedStops["1"].lines')),['Brown']);
  assert.equal(a.run('commuterRailStopsList.length'),1);
});

test('snapshot validation requires usable stops for every selected route',()=>{
  const a = app('boston',new Map(),'Orange,Blue');
  a.run(`
    var orange = {id:'Orange', stops:[{id:'one', lat:42.37, lng:-71.06}]};
    var blue = {id:'Blue', stops:[{id:'two', lat:42.37, lng:-71.05}]};
  `);
  assert.equal(a.run('snapshotHasSelectedLines({lines:[orange]})'),false);
  assert.equal(a.run('snapshotHasSelectedLines({lines:[orange,{...blue,stops:[]}]})'),false);
  assert.equal(a.run('snapshotHasSelectedLines({lines:[orange,blue]})'),true);
});
