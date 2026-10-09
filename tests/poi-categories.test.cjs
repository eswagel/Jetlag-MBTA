const test = require('node:test');
const assert = require('node:assert/strict');
const {categoryQueries} = require('../scripts/lib/poi-categories');
test('shared POI definitions preserve Boston and enforce Chicago semantics with configurable geography', () => {
  const bbox = {south:1,west:2,north:3,east:4};
  const boston = categoryQueries(bbox);
  const chicago = categoryQueries(bbox, 'chicago');
  assert.match(boston.medicalSites, /hospital\|clinic/);
  assert.match(boston.amusementParks, /amusement_arcade/);
  assert.equal(boston.hospitals, 'nwr["amenity"="hospital"](1,2,3,4);');
  assert.equal(chicago.hospitals, chicago.medicalSites);
  assert.match(chicago.hospitals, /healthcare.*!~/);
  assert.match(chicago.amusementParks, /leisure.*!=/);
  assert.match(chicago.libraries, /\(1,2,3,4\)/);
});
