const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const t=require('@turf/turf');const turf={...t,union:(a,b)=>t.union(t.featureCollection([a,b])),intersect:(a,b)=>t.intersect(t.featureCollection([a,b])),difference:(a,b)=>t.difference(t.featureCollection([a,b]))};
function context(city){const c=vm.createContext({console,turf,URLSearchParams,window:{location:{search:'?city='+city}},localStorage:{getItem:()=>null},document:{getElementById:()=>null},navigator:{}});for(const f of ['00-cities.js','01-core.js','03-setup.js'])vm.runInContext(fs.readFileSync('assets/js/app/'+f,'utf8'),c);return c;}
const contains=(features,xy)=>features.some(f=>t.booleanPointInPolygon(t.point(xy),f));
for(const city of ['boston','chicago']){
test(city+': partial catchments are temporary until all station area is eliminated',()=>{
 const c=context(city);vm.runInContext(`buildStopBaseRegionEntries=()=>[{id:'a',stop:{},baseRegion:turf.bboxPolygon([0,0,2,2])},{id:'b',stop:{},baseRegion:turf.bboxPolygon([3,0,4,1])}];`,c);
 const partial=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,1,2]),[])',c);
 assert.equal(partial.byStop.a.status,'temporary');assert.equal(partial.byStop.b.status,'eliminated');
 assert(contains(partial.greenFeatures,[.5,1]));assert(contains(partial.yellowFeatures,[1.5,1]));
 assert(!t.booleanPointInPolygon(t.point([1.5,1]),partial.hardUnion));
 const red=turf.difference(t.bboxPolygon([0,0,4,2]),partial.survivingCatchments);
 assert(!t.booleanPointInPolygon(t.point([1.5,1]),red));assert(t.booleanPointInPolygon(t.point([3.5,.5]),red));
 const whole=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,2,2]),[])',c);assert.equal(whole.byStop.a.status,'in-play');assert.equal(whole.yellowFeatures.length,0);
 const empty=vm.runInContext("deriveStopRegionState({type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[]}},[])",c);assert.equal(empty.byStop.a.status,'eliminated');assert.equal(empty.yellowFeatures.length,0);
});
test(city+': surviving overlapping catchment prevents premature red elimination',()=>{
 const c=context(city);vm.runInContext(`buildStopBaseRegionEntries=()=>[{id:'a',stop:{},baseRegion:turf.bboxPolygon([0,0,2,2])},{id:'b',stop:{},baseRegion:turf.bboxPolygon([1,0,3,2])}];`,c);
 const state=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,.5,2]),[])',c);
 assert.equal(state.byStop.b.status,'eliminated');
 assert(t.booleanPointInPolygon(t.point([1.5,1]),state.survivingCatchments));
 assert(!t.booleanPointInPolygon(t.point([2.5,1]),state.survivingCatchments));
});

test(city+': surviving catchment union cache follows base identity and surviving station IDs',()=>{
 const c=context(city);vm.runInContext(`var bases=[{id:'a',stop:{},baseRegion:turf.bboxPolygon([0,0,2,2])},{id:'b',stop:{},baseRegion:turf.bboxPolygon([3,0,4,1])}];buildStopBaseRegionEntries=()=>bases;var calls=0;var originalUnion=safeUnion;safeUnion=(a,b)=>{calls++;return originalUnion(a,b);};`,c);
 const first=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,1,2]),[])',c);
 assert.equal(vm.runInContext('calls',c),1);
 const moved=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([0,0,.5,2]),[])',c);
 assert.equal(vm.runInContext('calls',c),1,'same surviving IDs reuse union despite changed cut');
 assert.equal(first.survivingCatchments,moved.survivingCatchments);
 assert(contains(moved.yellowFeatures,[.75,1]));assert(!contains(moved.greenFeatures,[.75,1]));
 const eliminated=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([3,0,4,1]),[])',c);
 assert.equal(vm.runInContext('calls',c),2);assert.notEqual(moved.survivingCatchments,eliminated.survivingCatchments);
 assert(!t.booleanPointInPolygon(t.point([1,1]),eliminated.survivingCatchments));
 vm.runInContext("bases=[{id:'b',stop:{},baseRegion:turf.bboxPolygon([3,0,5,2])}];",c);
 const resized=vm.runInContext('deriveStopRegionState(turf.bboxPolygon([3,0,4,1]),[])',c);
 assert.equal(vm.runInContext('calls',c),3,'new base entries invalidate even with identical IDs');
 assert(t.booleanPointInPolygon(t.point([4.5,1]),resized.survivingCatchments));
});

}

test('hide radius change replaces base entries and invalidates the union cache',()=>{
 const c=context('chicago');vm.runInContext("stopLineMap.a={name:'A',lat:41.88,lng:-87.63,lines:[]};",c);
 const first=vm.runInContext('deriveStopRegionState(INIT_POLY,[])',c);
 const resized=vm.runInContext('hideRadiusMi=.5;deriveStopRegionState(INIT_POLY,[])',c);
 assert.notEqual(first.survivingCatchments,resized.survivingCatchments);
 assert(t.area(resized.survivingCatchments)>3.9*t.area(first.survivingCatchments));
});
