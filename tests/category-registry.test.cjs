const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function game(city){
 const c=vm.createContext({URLSearchParams,window:{location:{search:`?city=${city}`}},console});
 for(const file of ['00-cities.js','04-build.js','04-city-questions.js'])vm.runInContext(fs.readFileSync(`assets/js/app/${file}`,'utf8'),c);
 return code=>vm.runInContext(code,c);
}
for(const city of ['boston','chicago'])test(`${city}: changing category copy preserves ID, source and measurement semantics`,async()=>{
 const run=game(city);
 run(`globalThis.preloadedData={pois:{parks:[{name:'Park fixture',lat:1,lng:2}],amtrakLines:[{name:'Track fixture'}]}};globalThis.loadPoiData=async()=>{}; globalThis.lookupPoiCollection=keys=>preloadedData.pois[keys[0]]||[];globalThis.getNamedPoiCollection=()=>preloadedData.pois.parks;`);
 run(`resolveCategory('measure','park').label='Completely renamed';resolveCategory('measure','elevation').label='Height';resolveCategory('measure','amtrak').label='Railway';`);
 assert.equal(run(`resolveCategory('measure','A Park').id`),'park');
 assert.equal(run(`resolveCategory('measure','park').label`),'Completely renamed');
 assert.equal(run(`isSeaLevelMeasure(resolveCategory('measure','elevation'))`),true);
 assert.equal(run(`isLinearMeasure(resolveCategory('measure','amtrak'))`),true);
 assert.equal(run(`measureFilterConfig('park').dataKey`),'parks');
 assert.equal((await run(`resolveCategory('measure','park').instances()`))[0].name,'Park fixture');
 assert.equal((await run(`getMeasureLinearFeatures(resolveCategory('measure','amtrak'),{})`))[0].name,'Track fixture');
});
test('Chicago descriptors are configured before use without replacing shared functions',()=>{
 const run=game('chicago');
 assert.equal(run(`resolveCategory('measure','A County Border').id`),'ward_border');
 assert.equal(run(`resolveCategory('measure','ward_border').boundaryKey`),'ward');
 assert.equal(run(`resolveCategory('measure','water').dataKey`),'bodiesOfWaterLines');
 const source=fs.readFileSync('assets/js/app/04-city-questions.js','utf8');
 assert(!source.includes('MATCHING_CATS.splice'));
 assert(!source.includes('getMeasureLinearFeatures ='));
 assert(!source.includes('highlightBoundary ='));
});

for(const city of ['boston','chicago'])test(`${city}: empty selection never resolves to first category`,()=>{
 const run=game(city);
 for(const kind of ['matching','measure','nearest','tentacles']){
  assert.equal(run(`resolveCategory('${kind}',undefined)`),null);
  assert.equal(run(`resolveCategory('${kind}',{})`),null);
  assert.equal(run(`resolveCategory('${kind}','')`),null);
 }
});
