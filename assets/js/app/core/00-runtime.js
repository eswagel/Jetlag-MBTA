// ══════════════════════════════════════════════════════
//  GAME LINE DEFINITIONS
// ══════════════════════════════════════════════════════
// Red has one route ID ("Red") but two branches distinguished by route patterns.
// All other lines map 1:1 to a route ID.
const GAME_LINES = [
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

// stopId → { name, lat, lng, lines: Set<lineId> }
const stopLineMap = {};

// ══════════════════════════════════════════════════════
//  CONSTANTS & STATE
// ══════════════════════════════════════════════════════
const CENTER = [42.3601,-71.0589];
const S = 41.85, N = 42.80, W = -71.70, E = -70.40;
const T_BBOX = {minLat:42.18, maxLat:42.67, minLng:-71.55, maxLng:-70.85};
const DATA_FILES = {
  mbta: 'data/mbta-data.json',
  pois: 'data/pois.json',
  boundaries: 'data/boundaries.json',
  landmasses: 'data/landmasses.json',
  elevation: 'data/elevation-grid.json',
};
const INIT_POLY = turf.polygon([[
  [-71.70,41.85],[-70.40,41.85],[-70.40,42.80],[-71.70,42.80],[-71.70,41.85]
]]);
function cloneGeo(g){return JSON.parse(JSON.stringify(g));}

let map, maskLayer, borderLayer, radiusLayer, previewLayer, tentaclePreviewLayer, simulLayer, simulMaskLayer, pickedMarkers=[];
let townLayer, countyLayer, boundaryHighlightLayer;
const commuterRailStops = new Set();
const commuterRailStopsList = [];
let seekerPinMarkers = []; // seeker location dots — preserved across POI category changes
let thermoHandleMarker = null;
let validZone = cloneGeo(INIT_POLY);
let constraints = [];
let qtype=null, qparams={}, pickStep=-1, pickStepDefs=[];
let currentBuiltQuestion = null;
let outgoingQuestions = {};
let _saveGameTimer = null;
let hideRadiusMi = 0.25;   // set by setup screen
let mbdataReady  = false;  // true once MBTA data load completes
let gameMode = 'seeker';   // 'seeker' | 'hider' | 'dev'
let hiderStation = null;   // {name, lat, lng, lines:[...]} set when hider taps their station
let _pickingHiderStation = false;
const preloadedData = {
  mbta: null,
  pois: null,
  boundaries: null,
  landmasses: null,
  elevation: null,
};
const elevationPointCache = new Map();

// ══════════════════════════════════════════════════════
//  GAME MODE
// ══════════════════════════════════════════════════════
function selectMode(el){
  document.querySelectorAll('.mode-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  gameMode = el.dataset.mode;
}

function applyGameMode(){
  const badge = document.getElementById('mode-badge');

  // Tab visibility config per mode
  const MODES = {
    seeker: { tabs: ['build','boundary','log'], default: 'build',  badge: '🔭 Seeker',  cls: 'seeker' },
    hider:  { tabs: ['hider'],               default: 'hider',   badge: '🫣 Hider',   cls: 'hider'  },
    dev:    { tabs: ['build','boundary','hider','log'], default: 'build', badge: '🛠 Dev', cls: 'dev'    },
  };
  const cfg = MODES[gameMode] || MODES.dev;

  // Show/hide tab buttons
  document.querySelectorAll('.tab[data-tab]').forEach(t=>{
    t.style.display = cfg.tabs.includes(t.dataset.tab) ? '' : 'none';
  });

  // Show/hide panes
  document.querySelectorAll('.tab-pane').forEach(p=>{
    const tabId = p.id.replace('tab-','');
    p.style.display = cfg.tabs.includes(tabId) ? (tabId === cfg.default ? 'block' : 'none') : 'none';
  });

  // Sync active tab highlight
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===cfg.default));

  // Show mode badge
  badge.textContent = cfg.badge;
  badge.className = cfg.cls;
  badge.style.display = 'inline-block';

  // Hider mode: keep panel open and taller
  if(gameMode === 'hider'){
    document.getElementById('panel').classList.remove('collapsed');
    document.getElementById('tab-hider').classList.add('hider-mode-fullscreen');
  } else {
    document.getElementById('tab-hider').classList.remove('hider-mode-fullscreen');
  }
}
const SAVE_KEY = 'jetlag_mbta_save';

function cloneForStorage(value){
  return JSON.parse(JSON.stringify(value, (k,v)=>{
    if(k === '_constraint_union') return undefined;
    return v instanceof Set ? [...v] : v;
  }));
}

function buildTentacleOptionId(option, fallbackIndex=0){
  const existing = String(option?.id || '').trim();
  if(existing) return existing;
  const slug = String(option?.name || 'option')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'option';
  const lat = Number(option?.lat);
  const lng = Number(option?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(5)}_${lng.toFixed(5)}`.replace(/[^0-9._-]+/g, '_')
    : `idx_${fallbackIndex}`;
  return `tent_${slug}_${coords}`;
}

function normalizeTentacleOption(option, fallbackIndex=0){
  const lat = Number(option?.lat);
  const lng = Number(option?.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: buildTentacleOptionId(option, fallbackIndex),
    name: String(option?.name || `Option ${fallbackIndex + 1}`),
    lat,
    lng,
  };
}

function getTentacleReachMiles(question){
  return Math.max(0, Number(question?.radius_miles || 1));
}

function getTentacleOptionsInReach(question){
  const center = question?.center;
  if(!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return [];
  const reachMiles = getTentacleReachMiles(question);
  return (Array.isArray(question?.options) ? question.options : [])
    .map((opt, i)=>normalizeTentacleOption(opt, i))
    .filter(Boolean)
    .filter(opt => turfDist(center, opt) <= reachMiles);
}

function findTentacleOption(question, answer){
  const options = getTentacleOptionsInReach(question);
  if(answer == null) return null;
  const byId = options.find(opt => opt?.id === answer);
  if(byId) return byId;
  return options.some(opt => opt?.id)
    ? null
    : (options.find(opt => opt?.name === answer) || null);
}

function getTentacleAnswerLabel(question, answer){
  if(answer === 'no') return 'Not within range';
  return findTentacleOption(question, answer)?.name || String(answer || '');
}

function rememberOutgoingQuestion(question){
  if(!question?.id) return;
  outgoingQuestions[question.id] = cloneForStorage(question);
}

function getOutgoingQuestion(id){
  if(!id || !outgoingQuestions[id]) return null;
  return cloneForStorage(outgoingQuestions[id]);
}

function forgetOutgoingQuestion(id){
  if(!id || !outgoingQuestions[id]) return;
  delete outgoingQuestions[id];
}

function saveGame(){
  const setupOverlay = document.getElementById('setup-overlay');
  if(setupOverlay && !setupOverlay.classList.contains('hidden')) return;
  try{
    const save = {
      v: 1,
      ts: Date.now(),
      gameMode,
      hideRadiusMi,
      hiderStation: hiderStation || null,
      validZone: cloneGeo(validZone),
      constraints: constraints.map(cloneForStorage),
      outgoingQuestions: cloneForStorage(outgoingQuestions),
      buildState: typeof getSerializableBuildState === 'function' ? getSerializableBuildState() : null,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }catch(e){ console.warn('Save failed', e); }
}

function scheduleSaveGame(delay=120){
  const setupOverlay = document.getElementById('setup-overlay');
  if(setupOverlay && !setupOverlay.classList.contains('hidden')) return;
  clearTimeout(_saveGameTimer);
  _saveGameTimer = setTimeout(()=>{
    _saveGameTimer = null;
    saveGame();
  }, delay);
}

function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return null;
    const save = JSON.parse(raw);
    if(!save.v || !save.constraints || !save.validZone) return null;
    return save;
  }catch(e){ return null; }
}

function clearSave(){
  outgoingQuestions = {};
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;
  localStorage.removeItem(SAVE_KEY);
}

async function fetchOptionalJSON(path, label){
  try{
    const res = await fetch(path, {cache:'no-store'});
    if(!res.ok) return null;
    const data = await res.json();
    console.log(`Loaded ${label} from ${path}`);
    return data;
  }catch(e){
    console.warn(`Optional ${label} load failed:`, e);
    return null;
  }
}

async function loadPoiData(){
  if(preloadedData.pois) return preloadedData.pois;
  preloadedData.pois = await fetchOptionalJSON(DATA_FILES.pois, 'POIs');
  return preloadedData.pois;
}

async function loadBoundaryData(){
  if(preloadedData.boundaries) return preloadedData.boundaries;
  preloadedData.boundaries = await fetchOptionalJSON(DATA_FILES.boundaries, 'boundaries');
  return preloadedData.boundaries;
}

async function loadElevationData(){
  if(preloadedData.elevation) return preloadedData.elevation;
  preloadedData.elevation = await fetchOptionalJSON(DATA_FILES.elevation, 'elevation grid');
  return preloadedData.elevation;
}

async function fetchPointElevation(lat, lng){
  const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  if(elevationPointCache.has(key)) return elevationPointCache.get(key);
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  const promise = fetch(url, {headers:{'Accept':'application/json'}})
    .then(res => {
      if(!res.ok) throw new Error(`Elevation lookup failed (${res.status})`);
      return res.json();
    })
    .then(data => {
      const feet = Number(data?.value);
      if(!Number.isFinite(feet)) throw new Error('Invalid elevation response');
      return {
        feet,
        meters: feet * 0.3048,
        resolution: Number(data?.resolution) || null,
      };
    });
  elevationPointCache.set(key, promise);
  return promise;
}

function normKey(value){
  return String(value || '')
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\b(city|town)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deepClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function coerceFeature(item, name){
  if(!item) return null;
  if(item.type === 'Feature' && item.geometry) return deepClone(item);
  if(item.geometry && item.geometry.type){
    return {
      type:'Feature',
      properties:{name: item.name || name || item.properties?.name || ''},
      geometry: deepClone(item.geometry),
    };
  }
  return null;
}

function findFirstArray(obj, keys){
  if(!obj) return null;
  return keys.map(k => obj[k]).find(v => Array.isArray(v)) || null;
}

function normalizePlaces(items, fallbackName='Place'){
  return (items || []).map(item => ({
    name: item.name || fallbackName,
    lat: Number(item.lat),
    lng: Number(item.lng ?? item.lon),
  })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function pointsFromFeatureGeometry(feature, name='Border'){
  const out = [];
  const seen = new Set();
  const add = (coords) => {
    coords.forEach(([lng, lat]) => {
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if(!seen.has(key)){
        seen.add(key);
        out.push({lat, lng, name});
      }
    });
  };
  const geom = feature?.geometry;
  if(!geom) return out;
  if(geom.type === 'Polygon'){
    geom.coordinates.forEach(add);
  } else if(geom.type === 'MultiPolygon'){
    geom.coordinates.forEach(poly => poly.forEach(add));
  } else if(geom.type === 'LineString'){
    add(geom.coordinates);
  } else if(geom.type === 'MultiLineString'){
    geom.coordinates.forEach(add);
  }
  return out;
}

function featureToDisplayLines(feature){
  if(!feature?.geometry) return [];
  if(feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'){
    return [feature];
  }
  try{
    const lines = turf.polygonToLine(feature);
    if(lines?.type === 'FeatureCollection') return lines.features;
    if(lines?.type === 'Feature') return [lines];
  }catch(e){}
  return [];
}

function getBoundaryDataset(cat){
  const data = preloadedData.boundaries || {};
  if(cat === 'county') return findFirstArray(data, ['counties']);
  if(cat === 'city') return findFirstArray(data, ['cities', 'towns', 'municipalities']);
  if(cat === 'neighborhood') return findFirstArray(data, ['neighborhoods']);
  if(cat === 'postcode') return findFirstArray(data, ['postcodes', 'zipCodes', 'zip_codes']);
  return null;
}

function resolveBoundaryFromPreloaded(cat, center){
  const items = getBoundaryDataset(cat);
  if(!items?.length) return null;
  const pt = turf.point([center.lng, center.lat]);
  for(const item of items){
    const feature = coerceFeature(item, item.name);
    if(!feature) continue;
    try{
      if(turf.booleanPointInPolygon(pt, feature)){
        const val = item.name || feature.properties?.name || null;
        return val ? { val, boundary: feature } : null;
      }
    }catch(e){}
  }
  return null;
}

function lookupPoiCollection(keys){
  const items = findFirstArray(preloadedData.pois, keys);
  return normalizePlaces(items);
}

function lookupLinearPoiCollection(keys, fallbackName='Line'){
  const items = findFirstArray(preloadedData.pois, keys);
  if(!Array.isArray(items)) return [];
  return items.flatMap(item => pointsFromFeatureGeometry(coerceFeature(item, item.name), item.name || fallbackName));
}

function lookupLinearPoiFeatures(keys){
  const items = findFirstArray(preloadedData.pois, keys);
  return Array.isArray(items) ? items : [];
}

function getNamedPoiCollection(label){
  const keyMap = {
    'Park': ['parks'],
    'A Park': ['parks'],
    'Golf Course': ['golfCourses', 'golf_courses'],
    'A Golf Course': ['golfCourses', 'golf_courses'],
    'Library': ['libraries'],
    'A Library': ['libraries'],
    'Hospital': ['hospitals'],
    'A Hospital': ['hospitals'],
    'Museum': ['museums'],
    'A Museum': ['museums'],
    'Museums': ['museums'],
    'Movie Theater': ['movieTheaters', 'movie_theaters', 'cinemas'],
    'A Movie Theater': ['movieTheaters', 'movie_theaters', 'cinemas'],
    'Movie Theaters': ['movieTheaters', 'movie_theaters', 'cinemas'],
    'Zoo / Aquarium': ['zooAquariums', 'zoo_aquariums'],
    'A Zoo / Aquarium': ['zooAquariums', 'zoo_aquariums'],
    'Foreign Consulate': ['foreignConsulates', 'foreign_consulates', 'consulates'],
    'A Foreign Consulate': ['foreignConsulates', 'foreign_consulates', 'consulates'],
    'An Amusement Park': ['amusementParks', 'amusement_parks'],
    "Dunkin'": ['dunkin'],
    'Starbucks': ['starbucks'],
    'CVS': ['cvs'],
    "McDonald's": ['mcdonalds', 'mcDonalds'],
    'Hospitals': ['medicalSites', 'medical_sites', 'hospitals'],
    'Libraries': ['libraries'],
    'Parks': ['parks'],
    'Gas station': ['gasStations', 'gas_stations'],
    'A Body of Water': ['bodiesOfWater', 'bodies_of_water', 'waterBodies'],
    'Sea Level': ['seaLevel', 'sea_level', 'coastline'],
    'A Coastline': ['coastline', 'seaLevel', 'sea_level'],
  };
  const keys = keyMap[label];
  return keys ? lookupPoiCollection(keys) : [];
}

function getNamedLinearCollection(label){
  const keyMap = {
    'An Amtrak Line': ['amtrakLines', 'amtrak_lines'],
    'Sea Level': ['coastlineLines', 'coastline_lines'],
    'A Coastline': ['coastlineLines', 'coastline_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiCollection(keys, label) : [];
}

function getNamedLinearFeatures(label){
  const keyMap = {
    'An Amtrak Line': ['amtrakLines', 'amtrak_lines'],
    'Sea Level': ['coastlineLines', 'coastline_lines'],
    'A Coastline': ['coastlineLines', 'coastline_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiFeatures(keys) : [];
}

function getPreloadedBorderPoints(type){
  const items = getBoundaryDataset(type);
  if(!items?.length) return [];
  return items.flatMap(item => pointsFromFeatureGeometry(coerceFeature(item, item.name), item.name || 'Border'));
}

async function getCategoryInstances(catObj, center, radiusM){
  if(catObj.instances){
    try{
      const items = normalizePlaces(await catObj.instances(center, radiusM), catObj.label);
      if(items.length) return items;
    }catch(e){
      console.warn(`Instance lookup failed for ${catObj.label}:`, e);
    }
  }
  if(catObj.overpass){
    const items = await overpassSearch(catObj.overpass(center, radiusM), center, radiusM);
    return items.map(it=>({name:it.name || catObj.label, lat:it.lat, lng:it.lon || it.lng}));
  }
  return [];
}

function checkForResume(){
  const save = loadSave();
  if(!save) return;
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;
  // Don't prompt if the game hasn't really started (only setup constraint)
  const realConstraints = save.constraints.filter(c=>!['_setup'].includes(c.type));
  if(!realConstraints.length) return;

  const km2 = (turf.area(save.validZone)/1e6).toFixed(1);
  const age = timeSince(save.ts);
  const lastQ = [...realConstraints].reverse().find(c=>c.type&&!c.type.startsWith('_'));
  const lastDesc = lastQ ? (QDEFS[lastQ.type]?.label || lastQ.type) : 'Setup';

  document.getElementById('resume-summary').innerHTML =
    `<b>${realConstraints.length}</b> question${realConstraints.length!==1?'s':''} asked &nbsp;·&nbsp; ` +
    `<b>${km2} km²</b> remaining<br>` +
    `Last: <b>${lastDesc}</b><br>` +
    `<span style="color:var(--dim);font-size:8.5px">Saved ${age}</span>`;

  document.getElementById('resume-overlay').classList.remove('hidden');
}

function resumeGame(){
  const save = loadSave();
  if(!save){ discardAndNew(); return; }
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;

  hideRadiusMi = save.hideRadiusMi || 0.25;
  gameMode = save.gameMode || 'seeker';
  hiderStation = save.hiderStation || null;
  validZone = save.validZone;
  constraints = save.constraints;
  outgoingQuestions = save.outgoingQuestions || {};

  // Dismiss resume overlay and setup overlay
  document.getElementById('resume-overlay').classList.add('hidden');
  const ov = document.getElementById('setup-overlay');
  ov.classList.add('hidden');
  setTimeout(()=>{ ov.style.display='none'; }, 420);

  // Wait for MBTA data then restore
  const restore = () => {
    applyHideRadiusVisuals();
    renderZone();
    renderLog();
    applyGameMode();
    // Restore hider station pin if saved
    if(hiderStation){
      if(_hiderLocMarker) _hiderLocMarker.remove();
      _hiderLocMarker = L.marker([hiderStation.lat, hiderStation.lng], {icon:hiderPin(), zIndexOffset:3000}).addTo(map);
      renderHiderStationBadge();
    }
    const km2 = (turf.area(validZone)/1e6).toFixed(1);
    toast(`Game resumed — ${km2} km² in play`);
    if(save.buildState && typeof restoreSerializableBuildState === 'function'){
      restoreSerializableBuildState(save.buildState);
    }
    if(gameMode !== 'hider'){
      document.getElementById('panel').classList.remove('collapsed');
      setTimeout(()=>document.getElementById('panel').classList.add('collapsed'), 2000);
    }
    switchTab(save.buildState?.qtype ? 'build' : (gameMode === 'hider' ? 'hider' : 'log'));
  };
  if(mbdataReady) restore();
  else { const iv = setInterval(()=>{ if(mbdataReady){ clearInterval(iv); restore(); }}, 200); }
}

function discardAndNew(){
  clearSave();
  hiderStation = null;
  if(_hiderLocMarker){ _hiderLocMarker.remove(); _hiderLocMarker = null; }
  document.getElementById('resume-overlay').classList.add('hidden');
}

function timeSince(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s < 60) return 'just now';
  if(s < 3600) return `${Math.floor(s/60)}m ago`;
  if(s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// Draw radius circles without recomputing validZone (for resume)
function applyHideRadiusVisuals(){
  radiusLayer.clearLayers();
}
