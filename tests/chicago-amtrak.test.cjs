const test=require('node:test');
const assert=require('node:assert/strict');
const turf=require('@turf/turf');
const {build,CLIP}=require('../scripts/generate-chicago-amtrak.cjs');
const data=require('../data/chicago/pois.json');
function distance(xy){return Math.min(...data.amtrakLines.flatMap(f=>f.geometry.coordinates.map(l=>turf.pointToLineDistance(turf.point(xy),turf.lineString(l),{units:'kilometers'}))));}
test('Amtrak keeps curved track geometry and clips without joining disjoint paths',()=>{
 const f={type:'Feature',properties:{name:'Test'},geometry:{type:'MultiLineString',coordinates:[[[-89,42],[-88,42],[-87.8,41.8]], [[-87.6,41.5],[-87.5,41.4]]]}};
 const out=build({type:'FeatureCollection',features:[f]})[0];
 assert.deepEqual(out.geometry.coordinates[0],[[-88.5,42],[-88,42],[-87.8,41.8]]);
 assert.equal(out.geometry.coordinates.length,2);
 assert.throws(()=>build({type:'FeatureCollection',features:[f],exceededTransferLimit:true}),/Incomplete/);
});
test('Chicago Amtrak data contains rail routes, not stations or generic CTA tracks',()=>{
 assert(data.available.includes('amtrakLines'));
 assert(!data.unavailable.includes('amtrakLines'));
 assert(data.amtrakLines.some(f=>f.properties.name==='Hiawatha Service'));
 assert(data.amtrakLines.some(f=>f.properties.name==='California Zephyr'));
 assert(distance([-87.6404,41.8789])<0.2); // Union Station platforms
 assert(distance([-87.9048,41.9773])>5); // O'Hare CTA is not Amtrak
 for(const f of data.amtrakLines)for(const line of f.geometry.coordinates)for(const [x,y]of line){assert(x>=CLIP[0]&&x<=CLIP[2]&&y>=CLIP[1]&&y<=CLIP[3]);}
});
test('Amtrak reference coverage extends beyond nearest tracks throughout game area',()=>{
 // Dense samples compare known nearest track distance with the lower bound to
 // any excluded track beyond the source rectangle; include a mesh-diagonal margin.
 const border=turf.polygonToLine(turf.bboxPolygon(CLIP));
 for(let y=41.6;y<=42.120001;y+=0.04)for(let x=-88;x<=-87.47999;x+=0.04){
  const edge=turf.pointToLineDistance(turf.point([x,y]),border,{units:'kilometers'});
  assert(distance([x,y])+7<edge,`Insufficient reference margin at ${x},${y}`);
 }
});
