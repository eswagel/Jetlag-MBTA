const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function app(city='boston', storage=new Map()){
  const nodes = new Map();
  const context = vm.createContext({
    URLSearchParams, URL, console, setTimeout, clearTimeout,
    window:{location:{search:`?city=${city}`,href:`https://example.com/?city=${city}`}},
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
