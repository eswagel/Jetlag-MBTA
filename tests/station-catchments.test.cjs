const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const t=require('@turf/turf');const turf={...t,union:(a,b)=>t.union(t.featureCollection([a,b])),intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),difference:(a,b)=>t.difference(t.featureCollection([a,b]))};
function context(){const c=vm.createContext({console,turf,URLSearchParams,window:{location:{search:'?city=chicago'}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});for(const f of ['00-cities.js','01-core.js','03-setup.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);return c;}
const contains=(features,xy)=>features.some(f=>t.booleanPointInPolygon(t.point(xy),f));
test('partial catchments are temporary until all station area is eliminated',()=>{
 const c=context();vm.runInContext(`buildStopBaseRegionEntries=()=>[{id:'a',stop:{},baseRegion:turf.bboxPolygon([0,0,2,2])},{id:'b',stop:{},baseRegion:turf.bboxPolygon([3,0,4,1])}];`,c);
 const partial=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,1,2]),[])',c);
 assert.equal(partial.byStop.a.status,'temporary');assert.equal(partial.byStop.b.status,'eliminated');
 assert(contains(partial.greenFeatures,[.5,1]));assert(contains(partial.yellowFeatures,[1.5,1]));
 assert(!t.booleanPointInPolygon(t.point([1.5,1]),partial.hardUnion));
 const red=turf.difference(t.bboxPolygon([0,0,4,2]),partial.survivingCatchments);
 assert(!t.booleanPointInPolygon(t.point([1.5,1]),red));assert(t.booleanPointInPolygon(t.point([3.5,.5]),red));
 const whole=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,2,2]),[])',c);assert.equal(whole.byStop.a.status,'in-play');assert.equal(whole.yellowFeatures.length,0);
 const empty=vm.runInContext("deriveStopRegionState({type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[]}},[])",c);assert.equal(empty.byStop.a.status,'eliminated');assert.equal(empty.yellowFeatures.length,0);
});
test('surviving overlapping catchment prevents premature red elimination',()=>{
 const c=context();vm.runInContext(`buildStopBaseRegionEntries=()=>[{id:'a',stop:{},baseRegion:turf.bboxPolygon([0,0,2,2])},{id:'b',stop:{},baseRegion:turf.bboxPolygon([1,0,3,2])}];`,c);
 const state=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,.5,2]),[])',c);
 assert.equal(state.byStop.b.status,'eliminated');
 assert(t.booleanPointInPolygon(t.point([1.5,1]),state.survivingCatchments));
 assert(!t.booleanPointInPolygon(t.point([2.5,1]),state.survivingCatchments));
});
