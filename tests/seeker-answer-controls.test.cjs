const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const city of ['boston', 'chicago']) {
  test(`${city}: seekers can preview and directly apply either Radar answer`, () => {
    const elements = new Map();
    const context = vm.createContext({
      URLSearchParams, window: {location: {search: `?city=${city}`}},
      localStorage: {getItem: () => null}, navigator: {},
      document: {getElementById(id) {
        if (!elements.has(id)) elements.set(id, {innerHTML: '', classList: {add() {}, remove() {}}});
        return elements.get(id);
      }},
      turf: {polygon: coordinates => ({type: 'Feature', geometry: {type: 'Polygon', coordinates}})},
    });
    for (const file of ['00-cities.js', '01-core.js', '04-build.js']) {
      vm.runInContext(fs.readFileSync(`assets/js/app/${file}`, 'utf8'), context);
    }
    vm.runInContext(`
      clearZonePreview = () => {}; updatePreview = () => {};
      var question = {id:'radar-test', type:'radar', center:{lat:42.35,lng:-71.06}, radius_miles:1};
      renderSimulBtns(question); renderDirectApplyBtns(question);
    `, context);
    for (const id of ['simul-btns', 'direct-apply-btns']) {
      const html = elements.get(id).innerHTML;
      assert.equal((html.match(/<button/g) || []).length, 2);
      assert.match(html, /Within/); assert.match(html, /Outside/);
      assert.match(html, /#18b050/); assert.match(html, /#e84040/);
    }
    assert.match(elements.get('simul-btns').innerHTML, /previewAnswer\('yes'\)/);
    assert.match(elements.get('simul-btns').innerHTML, /previewAnswer\('no'\)/);
    // Re-rendering the editor clears its callback table; answer buttons must still work.
    vm.runInContext('_clearClicks(); _c(() => { throw new Error("stale editor callback"); })', context);
    const handlers = [...elements.get('direct-apply-btns').innerHTML.matchAll(/onclick="([^"]+)"/g)].map(match => match[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'"));
    vm.runInContext('var applied = []; applyBuiltAnswer = answer => applied.push(answer)', context);
    for (const handler of handlers) vm.runInContext(handler, context);
    assert.equal(vm.runInContext('applied.join(",")', context), 'yes,no');
  });
}
