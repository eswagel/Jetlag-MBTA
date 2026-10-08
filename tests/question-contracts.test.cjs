const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function game(city){
 const ctx=vm.createContext({turf:require("@turf/turf"),console,URLSearchParams,URL,setTimeout,clearTimeout,window:{location:{search:`?city=${city}`}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});
 for(const f of ['chicago-service.js','00-cities.js','linear-distance-filter.js','01-core.js','02-map.js','03-setup.js','04-build.js','05-hider.js','06-seeker.js','04-city-questions.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/app',f),'utf8'),ctx);

 return {ctx,run:s=>vm.runInContext(s,ctx)};
}
const center={lat:42,lng:-71};
const fixtures=[
 {id:'a',type:'radar',center,radius_miles:2},
 {id:'b',type:'thermo',center,thermo_dest:{lat:42.1,lng:-71},travel_miles:.5},
 {id:'c',type:'measure',center,category:'Example Feature',category_label:'Example Feature',mode:'distance',seeker_dist:1,seeker_nearest:center,all_instances:[center]},
 {id:'d',type:'tentacles',center,radius_miles:1,category:'Park',category_label:'Park',options:[{id:'1',name:'One',lat:42,lng:-71},{id:'2',name:'Two',lat:42.001,lng:-71}]},
 {id:'e',type:'matching',answer_opts:['Yes','No'],center,category:'city',category_label:'City',seeker_val:'Example',boundary_geojson:null},
 {id:'f',type:'nearest',center,category:'Parks',category_label:'Parks',seeker_poi:{...center,name:'Park'},all_pois:[center]},
 {id:'g',type:'photo',prompt:'Show the platform'},
];
for(const city of ['boston','chicago'])test(`${city}: every type restores editor inputs and preserves transport fields`,()=>{
 const g=game(city);g.ctx.fixtures=fixtures;
 g.run(`getTentacleOptionsInReach=q=>q.options;getTentacleDisplayOptions=q=>q.options;`);
 const result=g.run(`fixtures.map(q=>{const params=questionToBuildParams(q);const restored={id:q.id,...QDEFS[q.type].toJSON(params)};return [questionContractPacket(q),questionContractPacket(restored)]})`);
 for(const [before,after]of result)assert.deepEqual(JSON.parse(JSON.stringify(after)),JSON.parse(JSON.stringify(before)));
});
test('presets use contract aliases and defaults without carrying computed context',()=>{
 const g=game('boston');
 const result=JSON.parse(g.run(`JSON.stringify({radar:presetToBuildParams({build_qtype:'radar'}),nearest:presetToBuildParams({build_qtype:'matching',mode:'nearest',category:'park',category_label:'Park'}),measure:presetToBuildParams({build_qtype:'measure',category:'park',category_label:'Park',center:{lat:42,lng:-71},seeker_dist:8})})`));
 assert.equal(result.radar.radius_miles,1);assert.equal(result.nearest._matching_mode,'nearest');assert.equal(result.nearest.nearest_cat,'park');assert.equal(result.measure._mcat,'park');assert.equal(result.measure.measure_cat,'park');assert.equal(result.measure.center,undefined);assert.equal(result.measure.measure_seeker_dist,null);
});
test('hydration uses registered type resolvers and rejects unsupported types',async()=>{
 const g=game('boston');
 for(const type of fixtures.map(q=>q.type)){
  g.ctx.payload={...fixtures.find(q=>q.type===type)};
  g.run(`QUESTION_CONTRACTS[payload.type].hydrate=async q=>({...q,resolved:true})`);
  assert.equal((await g.run('hydrateOutgoingQuestionContent(payload)')).resolved,true);
 }
 g.ctx.payload={id:'z',type:'unknown'};await assert.rejects(g.run('hydrateOutgoingQuestionContent(payload)'),/Unsupported question/);
});
test('transport hydration restores coordinate and prompt questions without optional editor values',async()=>{
 const g=game('boston');
 for(const type of ['radar','thermo','photo']){
  g.ctx.payload={...fixtures.find(q=>q.type===type)};
  const result=await g.run('hydrateOutgoingQuestionContent(questionContractPacket(payload))');
  g.ctx.result=result;
  const [before,after]=JSON.parse(g.run('JSON.stringify([questionContractPacket(payload),questionContractPacket(result)])'));
  assert.deepEqual(after,before);
 }
});
test('point and numeric validation is driven by each question contract',()=>{
 const g=game('boston');
 for(const q of fixtures.filter(q=>q.center)){
  g.ctx.payload={...q,center:{lat:100,lng:-71}};
  assert.throws(()=>g.run('validateQuestionInputs(payload)'),/latitude and longitude/);
 }
 for(const [type,field]of [['radar','radius_miles'],['tentacles','radius_miles'],['thermo','travel_miles']]){
  g.ctx.payload={...fixtures.find(q=>q.type===type),[field]:-1};
  assert.throws(()=>g.run('validateQuestionInputs(payload)'),/positive/);
 }
});
test('explicit secondary aliases are not overwritten by primary alias defaults',()=>{
 const g=game('boston');
 g.ctx.boundary={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[]}};
 const result=JSON.parse(g.run(`JSON.stringify(questionFromBuildParams('matching',{_matching_boundary_simplified:boundary,matching_line_label:'Red'}))`));
 assert.deepEqual(result.boundary_geojson,g.ctx.boundary);
 assert.equal(result.seeker_val,'Red');
 const defaults=JSON.parse(g.run(`JSON.stringify(questionFromBuildParams('matching',{}))`));
 assert.equal(defaults.boundary_geojson,null);
 // Explicit nulls remain intentional clears, not an invitation to recover old data.
 const cleared=JSON.parse(g.run(`JSON.stringify(questionFromBuildParams('matching',{matching_boundary:null,_matching_boundary_simplified:boundary}))`));
 assert.equal(cleared.boundary_geojson,null);
});
