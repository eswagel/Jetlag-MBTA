const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const turf = require('@turf/turf');
function game(city){
  const ctx = vm.createContext({console,turf,URLSearchParams,URL,setTimeout,clearTimeout,
    window:{location:{search:`?city=${city}`}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
  for(const file of ['chicago-service.js','00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',file),'utf8'),ctx,{filename:file});
  }
  const run=code=>vm.runInContext(code,ctx);
  run(`
    renderBuildBody=updatePreview=tryGenerate=clearZonePreview=clearPoiMarkers=clearBoundaryHighlight=highlightBoundary=()=>{};
    toast=message=>{throw new Error(message)};
    map={fitBounds:()=>{}};
    L={latLngBounds:()=>({pad:()=>({})}),marker:()=>({addTo(){return this},bindPopup(){return this}})};
    measurePin=()=>null; renderAmtrakMeasureLines=()=>{};
    MeasurePointOverlay=class {constructor(_map,items){this.items=items}};
    preloadedData.pois={generatedAt:'test-source',sources:{'poi-osm':{snapshotSha256:'test-source'}}};
    qtype='measure';qparams={center:{lat:42,lng:-71}};
    loadElevationData=async()=>({values:[3]});
    fetchPointElevation=async()=>({feet:120,meters:36.576});
    getCategoryInstances=async()=>[
      {name:'Far',lat:42.1,lng:-71},
      {name:'Near',lat:42.001,lng:-71},
    ];
    getMeasureLinearFeatures=async()=>[{name:'Rail',geometry:{type:'LineString',coordinates:[[-71.01,41.9],[-71.01,42.1]]}}];
  `);
  // Adaptive filters display a notice; recording it must not change the result.
  run('toast=()=>{}');
  return {ctx,run};
}
for(const city of ['boston','chicago']){
  for(const kind of ['point','line','elevation']){
    test(`${city} ${kind}: creation, import reconstruction and hider use the same metric and source`,async()=>{
      const g=game(city);
      g.run(`var category=MEASURE_CATS.find(c=>${kind==='point'?"c.label==='A Park'":kind==='line'?"c.label==='An Amtrak Line'":"isSeaLevelMeasure(c.label)"});`);
      await g.run('selectMeasureCat(category)');
      const params=g.run('qparams');
      assert.equal(params._msearching,false);
      const result=await g.run('resolveMeasurement(category,qparams.center)');
      const packet=await g.run("rebuildMeasureQuestion({id:'test',type:'measure',category:category.label,center:qparams.center})");
      const answer=await g.run('resolveMeasureValue({category:category.label},qparams.center)');
      if(kind==='elevation'){
        assert.equal(params.measure_seeker_elevation_ft,120);
        assert.equal(packet.seeker_elevation_ft,answer.feet);
        assert.equal(result.mode,'elevation');
      }else{
        assert.equal(params.measure_seeker_dist,answer.dist);
        assert.equal(packet.seeker_dist,answer.dist);
        assert.equal(params.measure_seeker_nearest.name,answer.name);
        assert.equal(result.instances.length,kind==='point'?2:1);
        assert.equal(result.linearFeatures.length,kind==='line'?1:0);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(g.run('QDEFS.measure.toJSON(qparams)'))),JSON.parse(JSON.stringify((({id,...rest})=>rest)(packet))));
    });
  }
}
test('builder ignores a completed measurement for a superseded location',async()=>{
  const g=game('boston');
  g.run(`var release; getCategoryInstances=()=>new Promise(resolve=>release=resolve);`);
  const pending=g.run("selectMeasureCat(MEASURE_CATS.find(c=>c.label==='A Park'))");
  g.run("beginBuildLookup();qparams.center={lat:41,lng:-72};release([{name:'Old place',lat:42,lng:-71}])");
  await pending;
  assert.equal(g.run('qparams.measure_seeker_nearest'),null);
  assert.equal(g.run('qparams.center.lat'),41);
});
