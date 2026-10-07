const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({structuredClone});
vm.runInContext(fs.readFileSync('assets/js/app/02-map.js','utf8'),context);
vm.runInContext(fs.readFileSync('assets/js/app/00-city-picker.js','utf8'),context);
const build = vm.runInContext('CityTransitPreview.buildStyle',context);
test('a new city preview uses its own geometry and colors and excludes all street layers',()=>{
 const base={sources:{geography:{type:'vector'}},layers:[
  {id:'background',type:'background'}, {id:'lake',type:'fill','source-layer':'water'},
  {id:'river',type:'line','source-layer':'waterway'}, {id:'land',type:'fill','source-layer':'landcover'},
  {id:'roads',type:'line','source-layer':'transportation'}, {id:'labels',type:'symbol','source-layer':'place'},
  {id:'buildings',type:'fill','source-layer':'building'},
 ]};
 const profile={id:'third-city',lines:[{id:'route-a',color:'#123456'}]};
 const network={lines:[{id:'route-a',shapePath:[[10,20],[11,21]]}]};
 const style=build(base,network,profile);
 assert.deepEqual(Array.from(style.layers,l=>l.id),['background','lake','river','land','city-transit-solid','city-transit-dashed']);
 const feature=style.sources['city-transit'].data.features[0];
 assert.equal(feature.properties.color,'#123456');
 assert.equal(JSON.stringify(feature.geometry.coordinates),'[[20,10],[21,11]]');
 assert.equal(base.layers.length,7);
 assert.equal(base.sources['city-transit'],undefined);
});
