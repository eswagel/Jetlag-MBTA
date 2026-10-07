// City configuration is loaded before the game engine. A URL selects one city
// for the lifetime of the page so map layers and saved state cannot mix.
const BOSTON_LINES = [
  { id:'Red-Ashmont',   label:'Red · Ashmont',    color:'#DA291C', weight:5, routeId:'Red',     branchKeyword:'Ashmont'   },
  { id:'Red-Braintree', label:'Red · Braintree',   color:'#DA291C', weight:5, routeId:'Red',     branchKeyword:'Braintree' },
  { id:'Orange',        label:'Orange Line',        color:'#ED8B00', weight:5, routeId:'Orange'   },
  { id:'Blue',          label:'Blue Line',          color:'#003DA5', weight:5, routeId:'Blue'     },
  { id:'Green-B',       label:'Green Line · B',     color:'#00843D', weight:4, routeId:'Green-B'  },
  { id:'Green-C',       label:'Green Line · C',     color:'#00843D', weight:4, routeId:'Green-C'  },
  { id:'Green-D',       label:'Green Line · D',     color:'#00843D', weight:4, routeId:'Green-D'  },
  { id:'Green-E',       label:'Green Line · E',     color:'#00843D', weight:4, routeId:'Green-E'  },
  { id:'Mattapan',      label:'Mattapan Line',       color:'#DA291C', weight:4, routeId:'Mattapan' },
];
const CHICAGO_LINES = [
  {id:'Red', label:'Red Line', color:'#C60C30', routeId:'Red'},
  {id:'Blue', label:'Blue Line', color:'#00A1DE', routeId:'Blue'},
  {id:'Brown', label:'Brown Line', color:'#62361B', routeId:'Brn'},
  {id:'Green-Ashland', label:'Green · Ashland/63rd', color:'#009B3A', routeId:'G'},
  {id:'Green-Cottage', label:'Green · Cottage Grove', color:'#009B3A', routeId:'G'},
  {id:'Orange', label:'Orange Line', color:'#F9461C', routeId:'Org'},
  {id:'Pink', label:'Pink Line', color:'#E27EA6', routeId:'Pink'},
  {id:'Purple', label:'Purple Line', color:'#522398', routeId:'P'},
  {id:'Purple-Express', label:'Purple Express · service dependent', color:'#522398', routeId:'P', serviceDependent:true},
  {id:'Yellow', label:'Yellow Line', color:'#F9E300', routeId:'Y'},
].map(line => ({weight:4, ...line}));
const CITY_PROFILES = Object.freeze({
  boston: {
    id:'boston', name:'Boston', networkLabel:'MBTA', timezone:'America/New_York',
    datasetVersion:'boston-v1', center:[42.3601,-71.0589],
    bounds:{south:41.85,west:-71.70,north:42.80,east:-70.40},
    transitBounds:{south:42.18,west:-71.55,north:42.67,east:-70.85},
    dataFiles:{mbta:'data/mbta-data.json',pois:'data/pois.json',boundaries:'data/boundaries.json',landmasses:'data/landmasses.json',elevation:'data/elevation-grid.json'},
    lines:BOSTON_LINES,
  },
  chicago: {
    id:'chicago', name:'Chicago', networkLabel:'CTA', timezone:'America/Chicago',
    datasetVersion:'chicago-v1', center:[41.90,-87.69],
    bounds:{south:41.60,west:-88.00,north:42.12,east:-87.48},
    dataFiles:{mbta:'data/chicago/transit.json',pois:'data/chicago/pois.json',boundaries:'data/chicago/boundaries.json',landmasses:'data/chicago/landmasses.json',elevation:'data/chicago/elevation-grid.json'},
    lines:CHICAGO_LINES,
  },
});
const requestedCityId = new URLSearchParams(window.location.search).get('city') || 'boston';
const ACTIVE_CITY = CITY_PROFILES[requestedCityId] || CITY_PROFILES.boston;
function cityMetadata(){
  return {city_id:ACTIVE_CITY.id, dataset_version:ACTIVE_CITY.datasetVersion};
}
function stampCityPayload(payload){
  return {...payload, ...cityMetadata()};
}
function cityCompatibilityError(payload){
  if(!payload || typeof payload !== 'object') return 'Invalid game data.';
  if(!payload.city_id && !payload.dataset_version){
    return ACTIVE_CITY.id === 'boston' ? null : 'Legacy data belongs to Boston. Switch to Boston to use it.';
  }
  if(payload.city_id !== ACTIVE_CITY.id) return `This data belongs to ${payload.city_id || 'an unknown city'}. Switch cities to use it.`;
  if(payload.dataset_version !== ACTIVE_CITY.datasetVersion) return 'This data uses a different geography version. Use matching datasets to play together.';
  return null;
}
function selectCity(cityId){
  if(!CITY_PROFILES[cityId] || cityId === ACTIVE_CITY.id) return;
  if(typeof saveGame === 'function') saveGame();
  const url = new URL(window.location.href);
  url.searchParams.set('city', cityId);
  window.location.assign(url.href);
}
function renderCityProfile(){
  document.title = `Jet Lag — ${ACTIVE_CITY.networkLabel} ${ACTIVE_CITY.name}`;
  document.getElementById('city-selector').value = ACTIVE_CITY.id;
  const note = document.getElementById('city-preview-note');
  if(note){
    note.hidden = ACTIVE_CITY.id !== 'chicago';
    note.textContent = 'Chicago preview: elevation, places of interest, Amtrak track, body-of-water filtering and live Purple Express questions are not ready yet. ZIP matching uses Census ZIP areas (ZCTAs).';
  }
  document.getElementById('setup-eyebrow').textContent = `Jet Lag: The Game · ${ACTIVE_CITY.name}`;
  document.getElementById('setup-network').textContent = ACTIVE_CITY.networkLabel;
  document.getElementById('setup-description').textContent = `The hider picks a secret location on the ${ACTIVE_CITY.networkLabel} rail network, including suburban stations. Seekers eliminate zones by asking questions.`;
  document.querySelectorAll('[data-city-network-title]').forEach(el => {el.textContent = `Jet Lag · ${ACTIVE_CITY.networkLabel}`;});
  document.getElementById('setup-status-text').textContent = `Loading ${ACTIVE_CITY.networkLabel} network data…`;
  const legend = document.getElementById('legend');
  legend.querySelectorAll('.leg-row:not(#leg-status)').forEach(el=>el.remove());
  const status = document.getElementById('leg-status');
  ACTIVE_CITY.lines.forEach(line=>{
    const row = document.createElement('div');
    row.className = 'leg-row';
    const swatch = document.createElement('div');
    swatch.className = 'leg-line';
    swatch.style.background = line.color;
    row.append(swatch, document.createTextNode(line.label));
    legend.insertBefore(row, status);
  });
}
