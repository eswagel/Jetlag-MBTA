// Line definitions come from the active city profile.
const GAME_LINES = ACTIVE_CITY.lines;

// stopId → { name, lat, lng, lines: Set<lineId> }
const stopLineMap = {};

// ══════════════════════════════════════════════════════
//  CONSTANTS & STATE
// ══════════════════════════════════════════════════════
const CENTER = ACTIVE_CITY.center;
const {south:S, north:N, west:W, east:E} = ACTIVE_CITY.bounds;
const transitBounds = ACTIVE_CITY.transitBounds || ACTIVE_CITY.bounds;
const T_BBOX = {minLat:transitBounds.south, maxLat:transitBounds.north, minLng:transitBounds.west, maxLng:transitBounds.east};
const DATA_FILES = ACTIVE_CITY.dataFiles;
const INIT_POLY = turf.polygon([[[W,S],[E,S],[E,N],[W,N],[W,S]]]);

let map, maskLayer, softLayer, borderLayer, radiusLayer, previewLayer, tentaclePreviewLayer, simulLayer, simulMaskLayer, pickedMarkers=[];
let townLayer, countyLayer, boundaryHighlightLayer;
const commuterRailStops = new Set();
const commuterRailStopsList = [];
let seekerPinMarkers = []; // seeker location dots — preserved across POI category changes
let thermoHandleMarker = null;
let validZone = cloneGeo(INIT_POLY);
let softZone = null;
let stopRegionState = null;
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
const SAVE_KEY = `jetlag_${ACTIVE_CITY.id}_save`;
const LEGACY_SAVE_KEY = ACTIVE_CITY.id === 'boston' ? 'jetlag_mbta_save' : null;

function cloneForStorage(value){
  return JSON.parse(JSON.stringify(value, (k,v)=>{
    if(k === '_constraint_union') return undefined;
    return v instanceof Set ? [...v] : v;
  }));
}

// Old packets may contain hard/soft flags. They are accepted at ingestion,
// but cannot override the question definition's location/station/fixed scope.
function normalizeConstraintEntry(constraint){
  if(!constraint || typeof constraint !== 'object') return constraint;
  const next = {...constraint, constraint_scope:getQuestionConstraintScope(constraint)};
  delete next.constraint_effect;
  delete next.zone_effect;
  delete next.constraint_policy;
  return next;
}

// Compatibility belongs only at the wire boundary, never in gameplay or UI.
function legacyConstraintMetadata(question){
  return question?.type === 'matching' && getQuestionConstraintScope(question) === 'location'
    ? {constraint_effect:'soft', constraint_policy:{allow_soft:true, default_effect:'soft'}} : {};
}

function normalizeConstraintList(list){
  return Array.isArray(list) ? list.map(normalizeConstraintEntry) : [];
}

function emptyPolygonFeature(){
  return {type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[]}};
}
function isEmptyPolygonFeature(feature){
  const geometry=feature?.geometry || feature;
  return ['Polygon','MultiPolygon'].includes(geometry?.type) && Array.isArray(geometry.coordinates) && !geometry.coordinates.length;
}
// Exact overlays use null only for a successful empty result. Invalid geometry
// still throws; it must never be mistaken for proof that an area is eliminated.
function exactDiff(a,b){
  if(!a || isEmptyPolygonFeature(a))return null;
  if(!b || isEmptyPolygonFeature(b))return a;
  return turf.difference(a,b) || null;
}

function safeUnion(a, b){
  if(!a || isEmptyPolygonFeature(a)) return b || null;
  if(!b || isEmptyPolygonFeature(b)) return a || null;
  try{
    return turf.union(a, b) || a || b;
  }catch(e){
    return a || b;
  }
}

function geometryToPolygonFeatures(feature, baseProps={}){
  if(!feature) return [];
  const wrapped = feature.type === 'Feature'
    ? feature
    : (feature.geometry ? {type:'Feature', properties:feature.properties || {}, geometry:feature.geometry} : {type:'Feature', properties:{}, geometry:feature});
  try{
    const flat = turf.flatten(wrapped);
    return (flat?.features || [])
      .filter(item => item?.geometry?.type === 'Polygon')
      .map((item, idx) => ({
        type:'Feature',
        properties:{
          ...baseProps,
          ...(item.properties || {}),
          regionId: `${baseProps.regionKind || 'region'}_${idx}`,
        },
        geometry: cloneGeo(item.geometry),
      }));
  }catch(e){
    if(wrapped?.geometry?.type === 'Polygon'){
      return [{
        type:'Feature',
        properties:{
          ...baseProps,
          ...(wrapped.properties || {}),
          regionId: `${baseProps.regionKind || 'region'}_0`,
        },
        geometry: cloneGeo(wrapped.geometry),
      }];
    }
  }
  return [];
}

let _stopBaseRegionCache = { miles: null, stopCount: 0, entries: null };

function buildStopBaseRegionEntries(){
  const entries = Object.entries(stopLineMap);
  if(
    _stopBaseRegionCache.entries &&
    _stopBaseRegionCache.miles === hideRadiusMi &&
    _stopBaseRegionCache.stopCount === entries.length
  ){
    return _stopBaseRegionCache.entries;
  }

  const nextEntries = entries.map(([id, stop]) => {
    const baseRegion = exactIsect(INIT_POLY, makeCircle(stop, hideRadiusMi, 'miles'));
    return {
      id,
      stop:{
        name: stop.name,
        lat: stop.lat,
        lng: stop.lng,
        lines: stop.lines instanceof Set ? [...stop.lines] : [...(stop.lines || [])],
      },
      baseRegion,
    };
  }).filter(entry => entry.baseRegion);

  _stopBaseRegionCache = {
    miles: hideRadiusMi,
    stopCount: entries.length,
    entries: nextEntries,
  };
  return nextEntries;
}

// Question definitions classify constraints by what they describe, independently
// of the legacy hard/soft presentation flag carried by older question packets.
function getQuestionConstraintScope(question){
  const def = QDEFS[question?.type];
  if(!def || def.affectsZone === false) return 'none';
  return typeof def.constraintScope === 'function'
    ? def.constraintScope(question) : (def.constraintScope || 'location');
}

function compileConstraintPlan(baseZone, list){
  const questions = normalizeConstraintList(list);
  let fixedZone = baseZone;
  for(const question of questions){
    if(getQuestionConstraintScope(question) === 'fixed'){
      fixedZone = QDEFS[question.type].applyToZone(fixedZone, question) || emptyPolygonFeature();
    }
  }
  const observations = [];
  const stationQuestions = [];
  for(const question of questions){
    const scope = getQuestionConstraintScope(question);
    const def = QDEFS[question?.type];
    if(scope === 'station') stationQuestions.push(question);
    else if(scope === 'location' && (!def.hasSpatialContext || def.hasSpatialContext(question))){
      // Compute each answer's geometry once, without intersecting earlier
      // observations: the hider can move anywhere within their one catchment.
      observations.push(def.applyToZone(fixedZone, question) || emptyPolygonFeature());
    }
  }
  return {fixedZone, observations, stationQuestions};
}

// Cache only the union of full eligible catchments, never transient answer slices.
let _survivingCatchmentCache = null;
function deriveStopRegionState(baseZone, list){
  if(!baseZone) return null;
  const baseEntries = buildStopBaseRegionEntries();
  if(!baseEntries.length) return null;
  const {fixedZone, observations, stationQuestions} = compileConstraintPlan(baseZone, list);
  const byStop = {}, greenFeatures = [], yellowFeatures = [], survivingEntries = [];
  for(const {id, stop, baseRegion} of baseEntries){
    const eliminated = () => {
      byStop[id] = {stop, inPlay:false, status:'eliminated', hardRegion:null, greenRegion:null, yellowRegion:null};
    };
    // Station identity must be decided before geometry: neighboring stations
    // may have overlapping circles without sharing line membership.
    if(stationQuestions.some(q => !QDEFS[q.type].matchesStation({...stop, id}, q))){
      eliminated(); continue;
    }
    const hardRegion = exactIsect(fixedZone, baseRegion);
    if(!hardRegion){ eliminated(); continue; }
    let greenRegion = hardRegion;
    let possible = true;
    for(const observation of observations){
      const compatible = exactIsect(hardRegion, observation);
      if(!compatible){ possible = false; break; }
      greenRegion = compatible;
    }
    if(!possible){ eliminated(); continue; }
    const yellowRegion = exactDiff(hardRegion, greenRegion);
    survivingEntries.push({id, baseRegion});
    greenFeatures.push(...geometryToPolygonFeatures(greenRegion, {regionKind:'green', stopId:id}));
    if(yellowRegion) yellowFeatures.push(...geometryToPolygonFeatures(yellowRegion,
      {regionKind:'yellow', stopId:id, menuLabel:'Exclude region'}));
    byStop[id] = {stop, inPlay:true, hardRegion, greenRegion, yellowRegion,
      hasGreen:true, hasYellow:!!yellowRegion, status:yellowRegion ? 'temporary' : 'in-play'};
  }
  const survivingIds = JSON.stringify(survivingEntries.map(entry => entry.id));
  if(!_survivingCatchmentCache || _survivingCatchmentCache.baseEntries !== baseEntries ||
      _survivingCatchmentCache.survivingIds !== survivingIds){
    let union = null;
    for(const entry of survivingEntries) union = safeUnion(union, entry.baseRegion);
    _survivingCatchmentCache = {baseEntries, survivingIds, union:union || emptyPolygonFeature()};
  }
  const hardUnion = exactIsect(fixedZone, _survivingCatchmentCache.union) || emptyPolygonFeature();
  return {byStop, hardUnion, survivingCatchments:hardUnion,
    greenUnion:null, yellowUnion:null, greenFeatures, yellowFeatures};
}

function deriveZoneStateFromConstraints(baseZone, list){
  if(!baseZone) return {validZone:null, softZone:null, stopState:null};
  const stopState = deriveStopRegionState(baseZone, list);
  if(stopState) return {validZone:stopState.hardUnion, softZone:null, stopState};
  // Geometry-only consumers without a station dataset retain a conservative
  // result; live games always reduce against their station catchments above.
  const plan = compileConstraintPlan(baseZone, list);
  const zone = plan.observations.length ? plan.observations[plan.observations.length-1] : plan.fixedZone;
  return {validZone:zone, softZone:null, stopState:null};
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

function exactIsect(a,b){
  if(!a || !b || isEmptyPolygonFeature(a) || isEmptyPolygonFeature(b))return null;
  return turf.intersect(a,b) || null;
}

function buildTentacleRegions(question, zone=null){
  const circle = makeCircle(question.center, question.radius_miles || 1, 'miles');
  const scope = zone ? exactIsect(zone, circle) : circle;
  const options = getTentacleOptionsInReach(question);
  if(!scope || options.length < 2){
    return {circle, scope, regions:[],failed:options.length<2};
  }
  try{
    const bbox = expandBboxMiles(turf.bbox(circle), 0.25);
    const points = turf.featureCollection(options.map((opt, i)=>turf.point([opt.lng, opt.lat], {id:opt.id, name:opt.name, index:i})));
    const cells = turf.voronoi(points, {bbox});
    if(!cells?.features?.length || cells.features.some(cell=>!cell)) return {circle, scope, regions:[],failed:true};
    const regions = [];
    options.forEach((opt, i) => {
      const cell = cells.features[i];
      if(!cell) return;
      const region = exactIsect(scope, cell);
      if(!region) return;
      regions.push({option:opt, region, index:i});
    });
    return {circle, scope, regions};
  }catch(e){
    return {circle, scope, regions:[],failed:true};
  }
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
      v: 3,
      ...cityMetadata(),
      transit_feed_version: preloadedData.mbta?.feedVersion || null,
      ts: Date.now(),
      gameMode,
      hideRadiusMi,
      hiderStation: hiderStation || null,
      validZone: cloneGeo(validZone),
      softZone: softZone ? cloneGeo(softZone) : null,
      constraints: normalizeConstraintList(constraints).map(cloneForStorage),
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
    const raw = localStorage.getItem(SAVE_KEY) || (LEGACY_SAVE_KEY && localStorage.getItem(LEGACY_SAVE_KEY));
    if(!raw) return null;
    const save = JSON.parse(raw);
    if(!save.v || !save.constraints || !save.validZone || cityCompatibilityError(save)) return null;
    return save;
  }catch(e){ return null; }
}

function clearSave(){
  outgoingQuestions = {};
  softZone = null;
  stopRegionState = null;
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;
  localStorage.removeItem(SAVE_KEY);
  if(LEGACY_SAVE_KEY) localStorage.removeItem(LEGACY_SAVE_KEY);
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

function validElevationNumber(value){
  return typeof value === 'number' && Number.isFinite(value) && value > -30000;
}

function elevationGridCell(data, lat, lng){
  const ys=data?.latitudes, xs=data?.longitudes;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Array.isArray(ys)||!Array.isArray(xs)||ys.length<2||xs.length<2 ||
     lat<ys[0]||lat>ys[ys.length-1]||lng<xs[0]||lng>xs[xs.length-1]) return null;
  const row=Math.min(ys.length-2,ys.findIndex(y=>y>lat)-1 < 0 ? ys.length-2 : ys.findIndex(y=>y>lat)-1);
  const col=Math.min(xs.length-2,xs.findIndex(x=>x>lng)-1 < 0 ? xs.length-2 : xs.findIndex(x=>x>lng)-1);
  const values=[data.values?.[row]?.[col],data.values?.[row]?.[col+1],data.values?.[row+1]?.[col],data.values?.[row+1]?.[col+1]];
  if(!values.every(validElevationNumber)||xs[col+1]<=xs[col]||ys[row+1]<=ys[row]) return null;
  return {row,col,values,x:(lng-xs[col])/(xs[col+1]-xs[col]),y:(lat-ys[row])/(ys[row+1]-ys[row])};
}

function interpolateGridElevation(data, lat, lng){
  const cell=elevationGridCell(data,lat,lng);
  if(!cell) return null;
  const {x,y,values:[sw,se,nw,ne]}=cell;
  // Same southwest-to-northeast diagonal as the contour calculation.
  return x>=y ? sw+(se-sw)*x+(ne-se)*y : sw+(ne-nw)*x+(nw-sw)*y;
}

// Clip each terrain triangle against a horizontal elevation plane. This models the
// sampled grid, not exact continuous terrain or floors inside buildings.
function buildTriangulatedElevationFeature(data, thresholdFt, zoneBbox){
  const ys=data.latitudes,xs=data.longitudes,polys=[];
  function clippedTriangle(vertices){
    const out=[];
    for(let i=0;i<3;i++){
      const a=vertices[i],b=vertices[(i+1)%3],insideA=a[2]>=thresholdFt,insideB=b[2]>=thresholdFt;
      if(insideA)out.push(a.slice(0,2));
      if(insideA!==insideB){const t=(thresholdFt-a[2])/(b[2]-a[2]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    }
    if(out.length>=3){out.push(out[0]);polys.push([out]);}
  }
  for(let row=0;row<ys.length-1;row++){
    if(ys[row+1]<zoneBbox[1]||ys[row]>zoneBbox[3])continue;
    let runStart=null;
    function flush(col){if(runStart!==null){polys.push([[[xs[runStart],ys[row]],[xs[col],ys[row]],[xs[col],ys[row+1]],[xs[runStart],ys[row+1]],[xs[runStart],ys[row]]]]);runStart=null;}}
    for(let col=0;col<xs.length-1;col++){
      if(xs[col+1]<zoneBbox[0]||xs[col]>zoneBbox[2]){flush(col);continue;}
      const values=[data.values?.[row]?.[col],data.values?.[row]?.[col+1],data.values?.[row+1]?.[col],data.values?.[row+1]?.[col+1]];
      // Fail closed on damaged data instead of treating null/NODATA as sea level.
      if(!values.every(validElevationNumber))throw new Error('Incomplete elevation grid');
      if(values.every(v=>v>=thresholdFt)){if(runStart===null)runStart=col;continue;}
      flush(col);
      if(values.every(v=>v<thresholdFt))continue;
      const sw=[xs[col],ys[row],values[0]],se=[xs[col+1],ys[row],values[1]],nw=[xs[col],ys[row+1],values[2]],ne=[xs[col+1],ys[row+1],values[3]];
      clippedTriangle([sw,se,ne]);clippedTriangle([sw,ne,nw]);
    }
    flush(xs.length-1);
  }
  // An empty MultiPolygon represents a valid empty higher-than region.
  return {type:'Feature',properties:{approximate:true,interpolation:'triangulated-linear'},geometry:{type:'MultiPolygon',coordinates:polys}};
}

async function fetchPointElevation(lat, lng){
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) throw new Error('Invalid elevation location');
  const grid=preloadedData.elevation || await loadElevationData();
  if(grid?.pointLookup==='local-grid'){
    const feet=interpolateGridElevation(grid,lat,lng);
    if(feet===null)throw new Error('Location is outside the available elevation grid');
    return {feet,meters:feet*.3048,resolution:null,approximation:grid.approximation};
  }
  const key = `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  if(elevationPointCache.has(key)) return elevationPointCache.get(key);
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  const promise = fetch(url, {headers:{'Accept':'application/json'}})
    .then(res => {
      if(!res.ok) throw new Error(`Elevation lookup failed (${res.status})`);
      return res.json();
    })
    .then(data => {
      const raw=data?.value;
      const feet = typeof raw==='number' || (typeof raw==='string' && raw.trim()!=='') ? Number(raw) : NaN;
      if(!validElevationNumber(feet)) throw new Error('Invalid elevation response');
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

// Source IDs distinguish identically named places. Legacy snapshots use their exact coordinates.
function placeIdentity(place){
  return Object.fromEntries(['osmId','id','parentId'].filter(key=>place?.[key]!=null).map(key=>[key,String(place[key])]));
}
function samePlace(a,b){
  if(!a || !b) return false;
  for(const key of ['osmId','parentId','id']){
    if(a[key]!=null && b[key]!=null) return String(a[key])===String(b[key]);
  }
  return Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng??a.lon)) &&
    Math.abs(Number(a.lat)-Number(b.lat))<1e-7 && Math.abs(Number(a.lng??a.lon)-Number(b.lng??b.lon))<1e-7;
}

function normalizePlaces(items, fallbackName='Place'){
  return (items || []).map(item => ({
    ...placeIdentity(item),
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
  if(cat === 'ward') return findFirstArray(data, ['wards']);
  if(cat === 'community_area') return findFirstArray(data, ['communityAreas']);
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
  const spec=categorySpec('nearest',label);
  if(spec?.dataKey)return lookupPoiCollection([spec.dataKey]);
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
    'Hospitals': ACTIVE_CITY.id === 'chicago' ? ['hospitals'] : ['medicalSites', 'medical_sites', 'hospitals'],
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
  const spec=categorySpec('measure',label);
  if(spec?.mode==='linear' && spec.dataKey)return lookupLinearPoiCollection([spec.dataKey],spec.id);
  const keyMap = {
    'Lake Michigan shoreline': ['coastlineLines'],
    'A Body of Water': ACTIVE_CITY.id === 'chicago' ? ['bodiesOfWaterLines'] : [],
    'An Amtrak Line': ['amtrakLines', 'amtrak_lines'],
    'Sea Level': ['coastlineLines', 'coastline_lines'],
    'A Coastline': ['coastlineLines', 'coastline_lines'],
  };
  const keys = keyMap[label];
  return keys ? lookupLinearPoiCollection(keys, label) : [];
}

function getNamedLinearFeatures(label){
  const spec=categorySpec('measure',label);
  if(spec?.mode==='linear' && spec.dataKey)return lookupLinearPoiFeatures([spec.dataKey]);
  const keyMap = {
    'Lake Michigan shoreline': ['coastlineLines'],
    'A Body of Water': ACTIVE_CITY.id === 'chicago' ? ['bodiesOfWaterLines'] : [],
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
  if(adaptivePointConfig(catObj.id)) return normalizePlaces(await loadPointDistanceData(catObj.id),catObj.label);
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
    return normalizePlaces(items,catObj.label);
  }
  return [];
}

function checkForResume(){
  const save = loadSave();
  if(!save) return;
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;
  // Don't prompt if the game hasn't really started (only setup constraint)
  const realConstraints = normalizeConstraintList(save.constraints).filter(c=>!['_setup'].includes(c.type));
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

async function resumeGame(){
  const save = loadSave();
  if(!save){ discardAndNew(); return; }
  if(!mbdataReady){ toast(`Wait for ${ACTIVE_CITY.networkLabel} station data before resuming.`); return; }
  try{
    const questions = [...(save.constraints || []), ...Object.values(save.outgoingQuestions || {}), save.buildState?.currentBuiltQuestion];
    if(questions.some(q=>adaptiveLinearConfig(q)) || measureFilterConfig(save.buildState?.qparams?.measure_cat)){
      if(!await loadPoiData()) throw new Error('Distance geography could not be loaded. Retry when the dataset is available.');
    }
    for(const question of questions) if(adaptivePointConfig(question)) await loadPointDistanceData(question);
    validateSavedCityQuestions(save);
  }catch(e){ toast(e.message); return; }
  clearTimeout(_saveGameTimer);
  _saveGameTimer = null;

  hideRadiusMi = save.hideRadiusMi || 0.25;
  gameMode = save.gameMode || 'seeker';
  hiderStation = save.hiderStation || null;
  validZone = cloneGeo(save.validZone);
  softZone = save.softZone ? cloneGeo(save.softZone) : null;
  stopRegionState = null;
  constraints = normalizeConstraintList(save.constraints);
  outgoingQuestions = save.outgoingQuestions || {};

  // Dismiss resume overlay and setup overlay
  document.getElementById('resume-overlay').classList.add('hidden');
  const ov = document.getElementById('setup-overlay');
  ov.classList.add('hidden');
  setTimeout(()=>{ ov.style.display='none'; }, 420);

  // Wait for MBTA data then restore
  const restore = () => {
    applyHideRadiusVisuals();
    recomputeZoneFromConstraints();
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
  if(typeof onGameSessionReady === 'function') onGameSessionReady();
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

// ══════════════════════════════════════════════════════
//  QUESTION DEFINITIONS
// ══════════════════════════════════════════════════════
// One contract owns transport fields, editor aliases, presets and input validation.
// Resolvers remain type-specific because their geographic data requirements differ.
const QUESTION_CONTRACTS = {
  radar:{packet:['center','radius_miles'], inputs:{center:'point',radius_miles:'positive'}, answers:['yes','no'],
    fields:{center:'center',radius_miles:'radius_miles'}, presets:['radius_miles'], hydrate:q=>buildStoredRadarQuestion(q)},
  thermo:{packet:['center','thermo_dest','travel_miles'], inputs:{center:'point',thermo_dest:'point',travel_miles:'positive'}, answers:['closer','further'],
    fields:{center:'center',thermo_dest:'thermo_dest',travel_miles:'travel_miles'},presets:['travel_miles'],hydrate:q=>buildStoredThermoQuestion(q)},
  measure:{packet:['center','mode','category','category_id','category_label','linear_filter_version','point_filter_version','point_dataset'],inputs:{center:'point'},
    defaults:{mode:'distance'}, answers:q=>q.mode==='elevation'?['higher','lower']:['closer','further'],
    fields:{center:'center',category:'measure_cat',category_label:'measure_cat_label',mode:'measure_mode',seeker_nearest:'measure_seeker_nearest',seeker_dist:'measure_seeker_dist',seeker_elevation_ft:'measure_seeker_elevation_ft',seeker_elevation_m:'measure_seeker_elevation_m',all_instances:'measure_all_instances',linear_features:'measure_linear_features'},
    editorDefaults:{measure_seeker_nearest:null,measure_seeker_dist:null,measure_seeker_elevation_ft:null,measure_seeker_elevation_m:null,measure_all_instances:[],measure_linear_features:[]},
    presets:['category','category_label'], presetFields:{category:'_mcat',category_label:'_mcatlabel'},
    deriveEditor:q=>({measure_instance_count:q.point_dataset?preloadedData[q.point_dataset.dataset]?.[q.point_dataset.key]?.length:q.all_instances?.length}),
    hydrate:async q=>buildStoredMeasureQuestion(q)||await rebuildMeasureQuestion(q)},
  tentacles:{packet:['center','radius_miles','category','category_id','category_label','options'],inputs:{center:'point',radius_miles:'positive'}, defaults:{radius_miles:1},
    normalize:q=>({...q,category:q.category||q.category_label||null,category_label:q.category_label||q.category||null}),
    packetValues:{options:q=>getTentacleDisplayOptions(q).map(({id,name,lat,lng})=>({id,name,lat,lng}))},
    fields:{center:'center',radius_miles:'radius_miles',category:'_tcat',category_label:['_tcatlabel','tentacles_cat_label'],options:'tentacle_options'},editorDefaults:{tentacle_options:[]},presets:['radius_miles','category','category_label'],hydrate:q=>buildStoredTentaclesQuestion(q)},
  matching:{packet:['center','category','category_id','category_label','answer_opts'],inputs:{center:'point'},answers:['Yes','No'],
    packetExtra:q=>({...legacyConstraintMetadata(q),...(q.category==='line'?{seeker_val:q.seeker_val,line_id:q.line_id||null,hide_radius_miles:q.hide_radius_miles??hideRadiusMi,service_snapshot:q.service_snapshot||null}:{})}),
    fields:{center:'center',category:'matching_cat',category_label:'matching_cat_label',seeker_val:['matching_seeker_val','matching_line_label'],line_id:'matching_line_id',service_snapshot:'matching_service_snapshot',hide_radius_miles:'matching_hide_radius_miles',boundary_geojson:['matching_boundary','_matching_boundary_simplified']},
    editorDefaults:{_matching_mode:'matching',matching_line_id:null,matching_line_label:null,matching_service_snapshot:null,matching_boundary:null,_matching_boundary_simplified:null},
    deriveEditor:q=>({matching_hide_radius_miles:q.hide_radius_miles??hideRadiusMi}),presets:['category','category_label','line_id','seeker_val','hide_radius_miles'],
    hydrate:async q=>buildStoredMatchingQuestion(q)||await rebuildMatchingQuestion(q)},
  nearest:{packet:['center','category','category_id','category_label'],inputs:{center:'point'},answers:['Yes','No'],
    fields:{center:'center',category:'nearest_cat',category_label:'nearest_cat_label',seeker_poi:'nearest_seeker_poi',all_pois:'nearest_all_pois',voronoi_geojson:'nearest_voronoi'},
    editorDefaults:{_matching_mode:'nearest',nearest_all_pois:[],nearest_voronoi:null},presets:['category','category_label'],hydrate:async q=>buildStoredNearestQuestion(q)||await rebuildNearestQuestion(q)},
  photo:{packet:['prompt'],fields:{prompt:'photo_prompt'},defaults:{prompt:''},presets:['prompt'],hydrate:q=>buildStoredPhotoQuestion(q)},
};
function contractQuestion(q, contract){
  const value={...contract.defaults,...q};
  // Undefined fields from older packets must not mask contract defaults.
  for(const [key,fallback] of Object.entries(contract.defaults||{}))if(value[key]==null)value[key]=fallback;
  const normalized=contract.normalize?contract.normalize(value):value;
  const category=typeof resolveCategory==='function'?resolveCategory(q.type,q.category_id||q.category||q.category_label):null;
  if(category){normalized.category=category.id;normalized.category_id=category.id;normalized.category_label=category.label;}
  return normalized;
}
function questionContractPacket(question){
  const contract=QUESTION_CONTRACTS[question.type];
  if(!contract)return cloneForStorage(question);
  const q=contractQuestion(question,contract), packet={id:q.id,type:q.type};
  for(const field of contract.packet){
    const value=contract.packetValues?.[field]?contract.packetValues[field](q):q[field];
    if(value!==undefined)packet[field]=cloneForStorage(value);
  }
  return {...packet,...cloneForStorage(contract.packetExtra?.(q)||{})};
}
function contractBuildParams(question,{preset=false}={}){
  const base={radius_miles:1,travel_miles:0.5}, contract=QUESTION_CONTRACTS[question.type];
  if(!contract)return base;
  const q=contractQuestion(question,contract), result={...base,...cloneForStorage(contract.editorDefaults||{})};
  const fields=preset?contract.presets:Object.keys(contract.fields);
  for(const field of fields){
    if(q[field]===undefined)continue;
    for(const target of [].concat(contract.fields[field]||[]))result[target]=cloneForStorage(q[field]);
    if(preset)for(const target of [].concat(contract.presetFields?.[field]||[]))result[target]=cloneForStorage(q[field]);
  }
  Object.assign(result,contract.deriveEditor?.(q)||{});
  return result;
}
// Reverse the same aliases used by restoration rather than maintaining another field list.
function questionFromBuildParams(type, params){
  const contract=QUESTION_CONTRACTS[type], question={type};
  for(const [field,aliases] of Object.entries(contract.fields)){
    const keys=[].concat(aliases);
    // Explicit values on any alias take precedence over defaults on another alias.
    // A default null on the primary field must not hide a supplied legacy alias.
    const source=keys.some(alias=>params[alias]!==undefined)?params:(contract.editorDefaults||{});
    for(const alias of keys)if(source[alias]!==undefined){question[field]=cloneForStorage(source[alias]);break;}
  }
  return contractQuestion(question,contract);
}

const QDEFS = {
  radar:{
    label:'Radar', colorTag:'tag-radar',
    pickSteps:[{key:'center', label:'Tap map — set your location'}],
    isReady:p=>p.center&&p.radius_miles,
    toJSON:p=>questionFromBuildParams('radar',p),
    applyToZone:(zone,q)=>q.answer==='yes'?safeIsect(zone,makeCircle(q.center,q.radius_miles,'miles')):safeDiff(zone,makeCircle(q.center,q.radius_miles,'miles')),
    describe:q=>`<b>${q.answer==='yes'?'WITHIN':'OUTSIDE'}</b> ${q.radius_miles}mi radar`
  },
  thermo:{
    label:'Thermometer', colorTag:'tag-thermo',
    pickSteps:[{key:'center', label:'Tap map — your current position'}],
    isReady:p=>p.center&&p.travel_miles&&p.thermo_dest,
    toJSON:p=>questionFromBuildParams('thermo',p),
    applyToZone:(zone,q)=>{
      if(!q.center || !q.thermo_dest) return zone;
      const half = thermoHalf(q.center, q.thermo_dest, q.answer==='closer' ? 'b' : 'a');
      return safeIsect(zone, half);
    },
    describe:q=>`<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> to seeker after moving ${q.travel_miles}mi`
  },
  measure:{
    label:'Measure', colorTag:'tag-measure',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.measure_cat&&(
      p.measure_mode === 'elevation'
        ? Number.isFinite(p.measure_seeker_elevation_ft)
        : p.measure_seeker_dist!=null
    ),
    toJSON:p=>({
      ...questionFromBuildParams('measure',p),
      all_instances:adaptivePointConfig(p.measure_cat || p.measure_cat_label) ? [] : p.measure_all_instances||[],  // all known instances for zone geometry
      linear_features:measureFilterConfig(p.measure_cat) ? [] : (p.measure_linear_features||[]),
      ...(measureFilterConfig(p.measure_cat || p.measure_cat_label)?.mode==='adaptive-linear' ? {linear_filter_version:measureFilterConfig(p.measure_cat || p.measure_cat_label).version} : {}),
      ...pointDistanceMetadata(p.measure_cat || p.measure_cat_label),
      question:(p.measure_mode === 'elevation')
        ? `Are you at a higher or lower elevation than me? I am ${p.measure_seeker_elevation_ft.toFixed(0)} ft above sea level.`
        : `Compared to me, are you closer to or further from your nearest ${p.measure_cat_label}? I am ${p.measure_seeker_dist.toFixed(2)} mi from mine.`,
      answer_opts:(p.measure_mode === 'elevation') ? ['higher','lower'] : ['closer','further']
    }),
    applyToZone:(zone,q)=>{
      try{
        if(adaptiveLinearConfig(q)){
          const filter = buildAdaptiveLinearConstraint(q, zone);
          const excluded = q.answer === 'closer' ? filter.excludeForCloser : filter.excludeForFurther;
          return excluded ? (turf.difference(zone, excluded) || {type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[]}}) : zone;
        }
        // Always use this reduction scope; old caches may cover a smaller pre-undo zone.
        const union = buildMeasureConstraintUnion(q, zone);
        if(!union) return zone;
        if(q.mode==='elevation' && preloadedData.elevation?.interpolation==='triangulated-linear'){
          const empty={type:'Feature',properties:{},geometry:{type:'MultiPolygon',coordinates:[]}};
          if(!zone?.geometry?.coordinates?.length)return empty;
          if(!union.geometry.coordinates.length)return q.answer==='higher' ? empty : zone;
          return (q.answer==='higher' ? turf.intersect(zone,union) : turf.difference(zone,union)) || empty;
        }
        if(q.answer==='closer' || q.answer==='higher') return safeIsect(zone, union);
        return safeDiff(zone, union);
      }catch(e){ return zone; }
    },
    describe:q=>(q.mode === 'elevation')
      ? `<b>${q.answer==='higher'?'HIGHER':'LOWER'}</b> than seeker (${Number(q.seeker_elevation_ft).toFixed(0)} ft above sea level)`
      : `<b>${q.answer==='closer'?'CLOSER':'FURTHER'}</b> than seeker (${q.seeker_dist?.toFixed(2)}mi) from nearest ${q.category_label}${adaptiveLinearConfig(q) ? ' · uncertain map cells retained' : ''}`
  },
  tentacles:{
    label:'Tentacles', colorTag:'tag-tentacles',
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.tentacle_options&&p.tentacle_options.length>=2,
    toJSON:p=>({
      ...questionFromBuildParams('tentacles',p),
      options:getTentacleOptionsInReach({
        center:p.center,
        radius_miles:p.radius_miles||1,
        options:p.tentacle_options || [],
      }),
    }),
    applyToZone:(zone,q)=>{
      try{
        if(q.answer==='no')return safeDiff(zone,makeCircle(q.center,q.radius_miles || 1,'miles'));
        const option=findTentacleOption(q,q.answer);
        if(!option)return zone;
        const {scope,regions,failed}=buildTentacleRegions(q,zone);
        if(failed)return zone;
        if(!scope)return emptyPolygonFeature();
        return regions.find(item=>item.option.id===option.id)?.region || emptyPolygonFeature();
      }catch(e){return zone;}
    },
    describe:q=>q.answer==='no'
      ? `<b>NOT WITHIN</b> ${q.radius_miles||1}mi of seeker`
      : `<b>CLOSEST TO</b> ${q.answer_label || getTentacleAnswerLabel(q, q.answer)}`
  },
  matching:{
    label:'Matching', colorTag:'tag-matching',
    constraintScope:q=>q.category === 'line' ? 'station' : 'location',
    hasSpatialContext:q=>!!q.boundary_geojson,
    matchesStation:(station,q)=>stationMatchesQuestionLine(station,q) === (q.answer === 'Yes'),
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.matching_cat&&p.matching_seeker_val,
    toJSON:p=>({
      ...questionFromBuildParams('matching',p),
      service_snapshot:p.matching_service_snapshot || null,
      line_id:p.matching_cat === 'line' ? (p.matching_line_id || null) : null,
      hide_radius_miles:p.matching_cat === 'line' ? (p.matching_hide_radius_miles ?? hideRadiusMi) : null,
      boundary_geojson: p._matching_boundary_simplified || p.matching_boundary || null,
      question:(p.matching_cat === 'line')
        ? `Is your station on the same ${p.matching_cat_label}? Mine is "${p.matching_seeker_val}".`
        : `Are we in the same ${p.matching_cat_label}? Mine is "${p.matching_seeker_val}".`,
      answer_opts:['Yes','No']
    }),
    applyToZone:(zone,q)=>{
      if(!q.boundary_geojson) return zone;
      try{
        // `matching_boundary` is normalized to the actual containing region polygon.
        // Yes = keep only that region; No = eliminate that region.
        const result = q.answer==='Yes'
          ? safeIsect(zone, q.boundary_geojson)
          : safeDiff(zone, q.boundary_geojson);
        return result;
      } catch(e){ return zone; }
    },
    describe:q=>`<b>${q.answer==='Yes'?'SAME':'DIFFERENT'}</b> ${q.category_label} (seeker: ${q.seeker_val})`
  },
  nearest:{
    label:'Nearest', colorTag:'tag-nearest',
    hasSpatialContext:q=>!!q.voronoi_geojson,
    pickSteps:[{key:'center', label:'Tap map — your location'}],
    isReady:p=>p.center&&p.nearest_cat&&p.nearest_seeker_poi,
    toJSON:p=>({
      ...questionFromBuildParams('nearest',p),
      question:`Is the nearest ${p.nearest_cat_label} to you the same as mine? Mine is "${p.nearest_seeker_poi.name}".`,
      answer_opts:['Yes','No']
    }),
    applyToZone:(zone,q)=>{
      if(!q.voronoi_geojson) return zone;
      try{
        // Voronoi cell contains the "same nearest" region
        // Yes = hider shares same nearest → intersect (keep only that cell)
        // No = different nearest → difference (remove that cell)
        const result = q.answer==='Yes'
          ? safeIsect(zone, q.voronoi_geojson)
          : safeDiff(zone, q.voronoi_geojson);
        return result;
      }catch(e){ return zone; }
    },
    describe:q=>`Nearest ${q.category_label}: <b>${q.answer==='Yes'?'SAME':'DIFFERENT'}</b> (seeker's: ${q.seeker_poi?.name})`
  },
  photo:{
    affectsZone:false,
    label:'Photo', colorTag:'tag-photo',
    pickSteps:[],
    isReady:p=>p.photo_prompt&&p.photo_prompt.trim(),
    toJSON:p=>questionFromBuildParams('photo',p),
    applyToZone:(zone)=>zone,
    describe:q=>`📸 ${q.prompt}`
  },
  custom_boundary:{
    label:'Boundary', colorTag:'tag-nearest',
    constraintScope:'fixed',
    pickSteps:[],
    isReady:p=>Array.isArray(p.custom_boundary_points) && p.custom_boundary_points.length >= 3 && !!p.custom_boundary_mode,
    toJSON:p=>({
      type:'custom_boundary',
      boundary_geojson:p.custom_boundary_geojson,
      mode:p.custom_boundary_mode,
    }),
    applyToZone:(zone,q)=>{
      if(!q.boundary_geojson) return zone;
      return q.mode === 'include'
        ? safeIsect(zone, q.boundary_geojson)
        : safeDiff(zone, q.boundary_geojson);
    },
    describe:q=>q._label
      ? `<b>${String(q._label).toUpperCase()}</b>`
      : `<b>${q.mode==='include'?'INCLUDE':'EXCLUDE'}</b> custom boundary`
  }
};

// ══════════════════════════════════════════════════════
//  GEOMETRY
// ══════════════════════════════════════════════════════
function getActiveBuildQType(type=qtype, params=qparams){
  if(type === 'matching'){
    return params?._matching_mode === 'nearest' ? 'nearest' : 'matching';
  }
  return type;
}

function cloneGeo(g){return JSON.parse(JSON.stringify(g));}
function fmt(p){return`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;}
function toPt(p){return turf.point([p.lng,p.lat]);}
function turfDist(a,b){return turf.distance(toPt(a),toPt(b),{units:'miles'});}
function makeCircle(c,r,u){return turf.circle([c.lng,c.lat],r,{units:u,steps:72});}
function safeIsect(z,o){if(!z || !o)return z;try{return exactIsect(z,o) || emptyPolygonFeature();}catch(e){return z;}}
function safeDiff(z,o){try{return exactDiff(z,o) || emptyPolygonFeature();}catch(e){return z;}}

function compassHalf(ref,dir){
  const D=14,la=ref.lat,lo=ref.lng;
  const h={
    'N':[[lo-D,la],[lo+D,la],[lo+D,la+D],[lo-D,la+D],[lo-D,la]],
    'S':[[lo-D,la-D],[lo+D,la-D],[lo+D,la],[lo-D,la],[lo-D,la-D]],
    'E':[[lo,la-D],[lo+D,la-D],[lo+D,la+D],[lo,la+D],[lo,la-D]],
    'W':[[lo-D,la-D],[lo,la-D],[lo,la+D],[lo-D,la+D],[lo-D,la-D]],
    'NE':[[lo,la],[lo+D,la],[lo+D,la+D],[lo,la+D],[lo,la]],
    'NW':[[lo-D,la],[lo,la],[lo,la+D],[lo-D,la+D],[lo-D,la]],
    'SE':[[lo,la-D],[lo+D,la-D],[lo+D,la],[lo,la],[lo,la-D]],
    'SW':[[lo-D,la-D],[lo,la-D],[lo,la],[lo-D,la],[lo-D,la-D]]
  }[dir];
  return turf.polygon([h]);
}

function projectLocal(ll, origin){
  const lat0 = origin.lat * Math.PI / 180;
  return {
    x: (ll.lng - origin.lng) * 111.320 * Math.cos(lat0),
    y: (ll.lat - origin.lat) * 110.574,
  };
}

function unprojectLocal(pt, origin){
  const lat0 = origin.lat * Math.PI / 180;
  return [
    origin.lng + pt.x / (111.320 * Math.cos(lat0)),
    origin.lat + pt.y / 110.574,
  ];
}

function normVec(v){
  const d = Math.hypot(v.x, v.y) || 1;
  return {x: v.x / d, y: v.y / d};
}

function dividerFrame(ptA, ptB){
  const origin = {lat: ptA.lat, lng: ptA.lng};
  const b = projectLocal(ptB, origin);
  const along = normVec({x: b.x, y: b.y});
  const perp = {x: -along.y, y: along.x};
  return {origin, along, perp};
}

function thermoHalf(ptA,ptB,side){
  const {origin, along, perp} = dividerFrame(ptA, ptB);
  const toward = side === 'a' ? {x: -along.x, y: -along.y} : along;
  const halfWidthKm = 800;
  const depthKm = 1200;
  const ring = [
    unprojectLocal({x: perp.x * halfWidthKm, y: perp.y * halfWidthKm}, origin),
    unprojectLocal({x: perp.x * halfWidthKm + toward.x * depthKm, y: perp.y * halfWidthKm + toward.y * depthKm}, origin),
    unprojectLocal({x: -perp.x * halfWidthKm + toward.x * depthKm, y: -perp.y * halfWidthKm + toward.y * depthKm}, origin),
    unprojectLocal({x: -perp.x * halfWidthKm, y: -perp.y * halfWidthKm}, origin),
    unprojectLocal({x: perp.x * halfWidthKm, y: perp.y * halfWidthKm}, origin),
  ];
  return turf.polygon([ring]);
}

function thermoDividerLine(ptA,ptB){
  const {origin, perp} = dividerFrame(ptA, ptB);
  const reachKm = 1200;
  return turf.lineString([
    unprojectLocal({x: perp.x * reachKm, y: perp.y * reachKm}, origin),
    unprojectLocal({x: -perp.x * reachKm, y: -perp.y * reachKm}, origin),
  ]);
}

function makeBand(a,b,axis){
  const BIG=40;
  if(axis==='lat'){const mn=Math.min(a.lat,b.lat),mx=Math.max(a.lat,b.lat);return turf.polygon([[[-BIG*4,mn],[BIG*4,mn],[BIG*4,mx],[-BIG*4,mx],[-BIG*4,mn]]]);}
  else{const mn=Math.min(a.lng,b.lng),mx=Math.max(a.lng,b.lng);return turf.polygon([[[mn,-BIG],[mx,-BIG],[mx,BIG],[mn,BIG],[mn,-BIG]]]);}
}

function expandBboxMiles(bbox, miles){
  if(!Array.isArray(bbox) || bbox.length !== 4 || !Number.isFinite(miles)) return bbox;
  const midLat = ((bbox[1] + bbox[3]) / 2) * Math.PI / 180;
  const latDelta = miles / 69;
  const lngDelta = miles / (69 * Math.max(0.2, Math.cos(midLat)));
  return [
    bbox[0] - lngDelta,
    bbox[1] - latDelta,
    bbox[2] + lngDelta,
    bbox[3] + latDelta,
  ];
}

function clipFeatureToZone(feature, zone, miles){
  if(!feature || !zone) return feature;
  try{
    const bbox = expandBboxMiles(turf.bbox(zone), miles + 0.5);
    const clipped = turf.bboxClip(feature, bbox);
    if(clipped?.geometry) return clipped;
  }catch(e){}
  return feature;
}

function simplifyMeasureFeature(feature, q){
  if(!feature || ACTIVE_CITY.id === 'chicago') return feature;
  const isCoast = /coast|sea level/i.test(q?.category_label || q?.category || '');
  if(!isCoast) return feature;
  try{
    return turf.simplify(feature, {tolerance:0.005, highQuality:false}) || feature;
  }catch(e){
    return feature;
  }
}

function buildElevationConstraintFeature(q, zone=null){
  const data = preloadedData.elevation;
  const thresholdFt = q?.seeker_elevation_ft;
  const latitudes = data?.latitudes;
  const longitudes = data?.longitudes;
  const values = data?.values;
  if(!Number.isFinite(thresholdFt) || !Array.isArray(latitudes) || latitudes.length < 2 || !Array.isArray(longitudes) || longitudes.length < 2 || !Array.isArray(values)) return null;

  const zoneBbox = zone ? turf.bbox(zone) : [data.bbox?.west ?? longitudes[0], data.bbox?.south ?? latitudes[0], data.bbox?.east ?? longitudes[longitudes.length - 1], data.bbox?.north ?? latitudes[latitudes.length - 1]];
  if(data.interpolation==='triangulated-linear')return buildTriangulatedElevationFeature(data,thresholdFt,zoneBbox);
  const polys = [];

  for(let row = 0; row < latitudes.length - 1; row++){
    const south = latitudes[row];
    const north = latitudes[row + 1];
    if(north < zoneBbox[1] || south > zoneBbox[3]) continue;
    for(let col = 0; col < longitudes.length - 1; col++){
      const west = longitudes[col];
      const east = longitudes[col + 1];
      if(east < zoneBbox[0] || west > zoneBbox[2]) continue;

      const cellValues = [
        values?.[row]?.[col],
        values?.[row]?.[col + 1],
        values?.[row + 1]?.[col],
        values?.[row + 1]?.[col + 1],
      ].filter(validElevationNumber);
      if(cellValues.length < 3) continue;
      const avgFt = cellValues.reduce((sum, value) => sum + value, 0) / cellValues.length;
      if(avgFt < thresholdFt) continue;

      polys.push([[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]]);
    }
  }

  if(!polys.length) return emptyPolygonFeature();
  return turf.multiPolygon(polys);
}

function adaptiveLinearConfig(question){
  if(question?.type !== 'measure') return null;
  const config = measureFilterConfig(question.category_id || question.category || question.category_label);
  return ['adaptive-linear','adaptive-point'].includes(config?.mode) ? config : null;
}

function adaptivePointConfig(questionOrLabel){
  const question=typeof questionOrLabel==='string'?{type:'measure',category:questionOrLabel}:questionOrLabel;
  const config=adaptiveLinearConfig(question);
  return config?.mode==='adaptive-point'?config:null;
}

function pointDatasetReference(config){
  const source=preloadedData[config.dataset];
  const versions=config.versionPaths.map(path=>path.split('.').reduce((value,key)=>value?.[key],source));
  if(versions.some(value=>typeof value!=='string'||!value)) throw new Error('Point dataset version is unavailable');
  return {dataset:config.dataset,key:config.dataKey,version:versions.join(':')};
}

function pointDistanceMetadata(label){
  const config=adaptivePointConfig(label);
  return config?{point_filter_version:config.version,point_dataset:pointDatasetReference(config)}:{};
}

async function loadPointDistanceData(questionOrLabel){
  const config=adaptivePointConfig(questionOrLabel);
  if(!config) return null;
  if(config.dataset==='pois') await loadPoiData();
  else if(!preloadedData[config.dataset]){
    const response=await fetch(ACTIVE_CITY.dataFiles[config.dataset]);
    if(!response.ok) throw new Error('Local point dataset could not be loaded');
    preloadedData[config.dataset]=await response.json();
  }
  const points=preloadedData[config.dataset]?.[config.dataKey];
  if(!Array.isArray(points)||!points.length) throw new Error('Local point dataset is unavailable');
  pointDatasetReference(config);
  return points;
}

const pointFilterFeatures=new WeakMap();
function localPointFeatures(config){
  const points=preloadedData[config.dataset]?.[config.dataKey];
  if(!Array.isArray(points)||!points.length) throw new Error('Local point dataset is unavailable');
  if(!pointFilterFeatures.has(points)) pointFilterFeatures.set(points,points.map(point=>
    ({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[Number(point.lng??point.lon),Number(point.lat)]}})));
  return pointFilterFeatures.get(points);
}

function validateAdaptiveLinearQuestion(question){
  const config = adaptiveLinearConfig(question);
  if(config?.mode==='adaptive-point'){
    // Existing unversioned questions use the complete local source with their original distance threshold.
    if(config.acceptLegacyQuestions && !question.point_filter_version && !question.point_dataset) return;
    if(question.point_filter_version!==config.version || !question.point_dataset){
      throw new Error('This point-distance question uses an old map-filter version. Rebuild the question.');
    }
    if(preloadedData[config.dataset] && ['dataset','key','version'].some(key=>question.point_dataset[key]!==pointDatasetReference(config)[key])){
      throw new Error('This point-distance question uses a different local dataset. Use matching datasets to play.');
    }
    return;
  }
  if(config && question.linear_filter_version !== config.version){
    throw new Error('This distance question uses a different map-filter version. Rebuild the question.');
  }
}

function buildAdaptiveLinearConstraint(question, zone){
  validateAdaptiveLinearQuestion(question);
  const config = adaptiveLinearConfig(question);
  if(!config || typeof LinearDistanceFilter === 'undefined') throw new Error('Distance filter is unavailable');
  const features = config.mode==='adaptive-point' ? localPointFeatures(config) : preloadedData.pois?.[config.dataKey] || question.linear_features;
  return LinearDistanceFilter.build(features, question.seeker_dist, zone);
}

function buildMeasureConstraintUnion(q, zone=null){
  if(!q) return null;
  // Adaptive filters have two certified exclusion regions, not one approximate buffer.
  if(adaptiveLinearConfig(q)) return null;
  try{
    if(q.mode === 'elevation'){
      const feature = buildElevationConstraintFeature(q, zone);
      if(!feature) return null;
      if(preloadedData.elevation?.interpolation==='triangulated-linear') return feature;
      try{
        return turf.simplify(feature, {tolerance:0.0008, highQuality:false}) || feature;
      }catch(e){
        return feature;
      }
    }

    if(!Number.isFinite(q.seeker_dist)) return null;
    let union = null;
    if(q.linear_features?.length){
      const buffered = q.linear_features
        .map(item => coerceFeature(item, item.name))
        .filter(Boolean)
        .map(feature => {
          try{
            const clipped = clipFeatureToZone(feature, zone, q.seeker_dist);
            const simplified = simplifyMeasureFeature(clipped, q);
            return turf.buffer(simplified, q.seeker_dist, {units:'miles'});
          }catch(e){ return null; }
        })
        .filter(Boolean);
      union = buffered[0] || null;
      for(let i=1;i<buffered.length;i++){
        try{ union = turf.union(union, buffered[i]) || union; }catch(e){}
      }
    } else if(q.all_instances?.length){
      const circles = q.all_instances.map(p=>makeCircle(p, q.seeker_dist, 'miles'));
      union = circles[0] || null;
      for(let i=1;i<circles.length;i++){
        try{ union = turf.union(union, circles[i]) || union; }catch(e){}
      }
    }
    if(!union) return null;
    if(ACTIVE_CITY.id === 'chicago') return union;
    try{
      return turf.simplify(union, {tolerance:0.0008, highQuality:false}) || union;
    }catch(e){
      return union;
    }
  }catch(e){
    return null;
  }
}

function buildCustomBoundaryFeature(points){
  if(!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map(p => [p.lng, p.lat]);
  const first = ring[0], last = ring[ring.length - 1];
  if(first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  try{
    return turf.polygon([ring]);
  }catch(e){
    return null;
  }
}
