// Shared OSM category definitions; Boston retains the original selectors.
const definitions = require('./poi-categories.json');
function categoryQueries(bbox, city = 'boston') {
  const rules = {...definitions.default, ...(definitions[city] || {})};
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return Object.fromEntries(Object.entries(rules).map(([category, alternatives]) => [category,
    alternatives.map(terms => 'nwr' + terms.map(([key, op, value]) => op === 'present'
      ? `[${JSON.stringify(key)}]`
      : `[${JSON.stringify(key)}${op === '~i' ? '~' : op}${JSON.stringify(value)}${op === '~i' ? ',i' : ''}]`
    ).join('') + `(${box});`).join(' ')
  ]));
}
module.exports = {categoryQueries};
