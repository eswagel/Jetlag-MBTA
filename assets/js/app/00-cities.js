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
  { id:'Mattapan',      label:'Mattapan Line',       color:'#DA291C', weight:4, routeId:'Mattapan', dashArray:'8 5' },
].map(line => {
  const physicalLineId = line.id.startsWith('Green-') ? 'Green' : line.id.startsWith('Red-') ? 'Red' : line.id;
  return {...line, physicalLineId, branchId:line.id === physicalLineId ? null : line.id.slice(physicalLineId.length + 1), displayLabel:`${physicalLineId} Line`};
});
const CHICAGO_LINES = [
  {id:'Red', label:'Red Line', color:'#C60C30', routeId:'Red'},
  {id:'Blue', label:'Blue Line', color:'#00A1DE', routeId:'Blue'},
  {id:'Brown', label:'Brown Line', color:'#62361B', routeId:'Brn'},
  {id:'Green-Ashland', label:'Green · Ashland/63rd', color:'#009B3A', routeId:'G'},
  {id:'Green-Cottage', label:'Green · Cottage Grove', color:'#009B3A', routeId:'G'},
  {id:'Orange', label:'Orange Line', color:'#F9461C', routeId:'Org'},
  {id:'Pink', label:'Pink Line', color:'#E27EA6', routeId:'Pink'},
  {id:'Purple', label:'Purple Line', color:'#522398', routeId:'P', serviceDependent:true, displaySources:[{id:'Purple'},{id:'Purple-Express',serviceVariant:'express',dashArray:'8 5',includeStationMembership:false}]},
  {id:'Yellow', label:'Yellow Line', color:'#F9E300', routeId:'Y'},
].map(line => {
  const physicalLineId = line.id.startsWith('Green-') ? 'Green' : line.id;
  return {weight:4, ...line, physicalLineId, branchId:line.id === physicalLineId ? null : line.id.slice(physicalLineId.length + 1), displayLabel:`${physicalLineId} Line`};
});
// Point categories share one engine and reference local datasets, independently of city.
const POINT_MEASURE_CATEGORIES = {
  'A Park':'parks','An Amusement Park':'amusementParks','A Zoo / Aquarium':'zooAquariums',
  'A Golf Course':'golfCourses','A Museum':'museums','A Movie Theater':'movieTheaters',
  'A Hospital':'hospitals','A Library':'libraries','A Foreign Consulate':'foreignConsulates',
};
function pointMeasureFilters(categories, dataset='pois', versionPaths=['sources.poi-osm.snapshotSha256'], options={}){
  return Object.fromEntries(Object.entries(categories).map(([label,dataKey]) =>
    [label,{mode:'adaptive-point',version:'adaptive-point-v1',dataKey,dataset,versionPaths,...options}]));
}
// Stable identities are independent of translated or city-specific display labels.
const CATEGORY_SPECS = [
  ['park','parks',['Park','A Park','Parks']],
  ['golf_course','golfCourses',['Golf Course','A Golf Course']],
  ['library','libraries',['Library','A Library','Libraries']],
  ['hospital','hospitals',['Hospital','A Hospital','Hospitals']],
  ['museum','museums',['Museum','A Museum','Museums']],
  ['movie_theater','movieTheaters',['Movie Theater','A Movie Theater','Movie Theaters']],
  ['zoo_aquarium','zooAquariums',['Zoo / Aquarium','A Zoo / Aquarium']],
  ['consulate','foreignConsulates',['Foreign Consulate','A Foreign Consulate']],
  ['amusement_park','amusementParks',['An Amusement Park']],
  ['dunkin','dunkin',["Dunkin'"]],
  ['commuter_rail','commuterRail',['A Commuter Rail Station']],
  ['amtrak','amtrakLines',['An Amtrak Line'],'linear'],
  ['coastline','coastlineLines',['A Coastline','Lake Michigan shoreline'],'linear'],
  ['elevation',null,['Sea Level','Elevation'],'elevation'],
  ['water','bodiesOfWater',['A Body of Water']],
  ['county_border',null,['A County Border'],'point','county'],
  ['city_border',null,['A City Border'],'point','city'],
  ['ward_border',null,['A Ward Border'],'linear','ward'],
].map(([id,dataKey,aliases,mode='point',boundaryKey])=>({id,dataKey,aliases,mode,boundaryKey}));
function categorySpec(kind, value){
  const key=typeof value==='object' ? value?.id || value?.category_id || value?.category || value?.label : value;
  if(kind==='matching') return {id:key,cat:key};
  const base=CATEGORY_SPECS.find(item=>item.id===key || item.aliases.includes(key));
  if(!base)return null;
  const overrides=ACTIVE_CITY.questionCategories?.[base.id] || {};
  return {...base,...overrides};
}
function measureFilterConfig(value){
  const spec=categorySpec('measure',value);
  if(!spec)return null;
  return ACTIVE_CITY.measureFilters?.[spec.id] || spec.aliases.map(alias=>ACTIVE_CITY.measureFilters?.[alias]).find(Boolean) || null;
}
function configureQuestionCategories(kind, definitions){
  if(kind==='matching'){
    const config=ACTIVE_CITY.matchingCategories;
    if(!config)return definitions.map(item=>({...item,id:item.cat}));
    return config.map(({id,label,icon,resolver})=>{
      const original=definitions.find(item=>item.cat===id);
      return {...original,id,cat:id,label:label || original?.label,icon:icon || original?.icon,
        resolve:resolver==='service' ? (...args)=>resolveChicagoLine(...args) : resolver==='boundary' ? center=>resolveChicagoBoundary(id,center) : original.resolve};
    });
  }
  return definitions.map(original=>{
    const spec=categorySpec(kind,original.label);
    if(!spec)throw new Error(`Unknown ${kind} category: ${original.label}`);
    const item={...original,...spec,label:spec.label || original.label};
    if(ACTIVE_CITY.localQuestionsOnly){
      delete item.overpass;
      item.instances=async()=>{
        if(item.id==='commuter_rail')return commuterRailStopsList;
        await loadPoiData();
        const values=lookupPoiCollection([item.dataKey]);
        if(!values.length)throw new Error(`Verified ${ACTIVE_CITY.name} ${item.label} data is not available yet`);
        return values;
      };
    }
    return item;
  });
}
function resolveCategory(kind,value){
  const definitions=kind==='matching'?MATCHING_CATS:kind==='measure'?MEASURE_CATS:kind==='nearest'?NEAREST_CATS:TENTACLES_CATS;
  const key=typeof value==='object'?value?.id || value?.category_id || value?.category || value?.label:value;
  return definitions.find(item=>item.id===key || item.cat===key || item.label===key || item.aliases?.includes(key));
}
const CITY_PROFILES = Object.freeze({
  boston: {
    id:'boston', name:'Boston', networkLabel:'MBTA', timezone:'America/New_York',
    datasetVersion:'boston-v1', center:[42.3601,-71.0589],
    bounds:{south:41.85,west:-71.70,north:42.80,east:-70.40},
    transitBounds:{south:42.18,west:-71.55,north:42.67,east:-70.85},
    dataFiles:{mbta:'data/mbta-data.json',pois:'data/pois.json',boundaries:'data/boundaries.json',landmasses:'data/landmasses.json',elevation:'data/elevation-grid.json'},
    measureFilters:{
      ...pointMeasureFilters({...POINT_MEASURE_CATEGORIES,'A Body of Water':'bodiesOfWater'},'pois',['generatedAt'],{acceptLegacyQuestions:true}),
      ...pointMeasureFilters({'A Commuter Rail Station':'commuterRail'},'mbta',['generatedAt'],{acceptLegacyQuestions:true}),
    },
    lines:BOSTON_LINES,
  },
  chicago: {
    id:'chicago', name:'Chicago', networkLabel:'CTA', timezone:'America/Chicago',
    localQuestionsOnly:true,
    matchingCategories:[
      {id:'line',label:'CTA Line',resolver:'service'}, {id:'landmass'},
      {id:'city',label:'City / Municipality',icon:'🏙️',resolver:'boundary'},
      {id:'ward',label:'Ward',icon:'🏛️',resolver:'boundary'},
      {id:'community_area',label:'Community Area',icon:'🏘️',resolver:'boundary'},
      {id:'postcode',label:'ZIP Code (ZCTA)',icon:'📮',resolver:'boundary'},
    ],
    questionCategories:{
      elevation:{label:'Elevation'},coastline:{label:'Lake Michigan shoreline'},
      county_border:{id:'ward_border',label:'A Ward Border',boundaryKey:'ward',mode:'linear'},
      city_border:{mode:'linear'},water:{mode:'linear',dataKey:'bodiesOfWaterLines'},
    },
    datasetVersion:'chicago-v1', center:[41.90,-87.69],
    measureFilters:{...pointMeasureFilters(POINT_MEASURE_CATEGORIES),...pointMeasureFilters({'A Commuter Rail Station':'commuterRail'},'mbta',['sources.metra.sha256','sources.southshore.sha256']),
    'A Body of Water':{mode:'adaptive-linear',version:'adaptive-linear-v1',dataKey:'bodiesOfWaterLines'}},
    previewNote:'Purple uses a saved timetable when live data is unavailable. ZIP matching uses Census ZIP areas (ZCTAs).',
    bounds:{south:41.60,west:-88.00,north:42.12,east:-87.48},
    dataFiles:{mbta:'data/chicago/transit.json',pois:'data/chicago/pois.json',boundaries:'data/chicago/boundaries.json',landmasses:'data/chicago/landmasses.json',elevation:'data/chicago/elevation-grid.json'},
    lines:CHICAGO_LINES,
  },
});
const requestedCityId = new URLSearchParams(window.location.search).get('city') || 'boston';
const ACTIVE_CITY = CITY_PROFILES[requestedCityId] || CITY_PROFILES.boston;
const IS_GAME_SESSION = new URLSearchParams(window.location.search).get('play') === '1';
let selectedCityId = ACTIVE_CITY.id;
let cityPicker;
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
  if(!CITY_PROFILES[cityId] || cityId === selectedCityId) return;
  selectedCityId = cityId;
  cityPicker.setSelected(cityId);
  renderSetupProfile(CITY_PROFILES[cityId]);
  const url = new URL(window.location.href);
  url.searchParams.set('city',cityId);
  window.history.replaceState(null,'',url);
}
function renderSetupProfile(profile){
  document.title = `Jet Lag — ${profile.networkLabel} ${profile.name}`;
  const note = document.getElementById('city-preview-note');
  note.hidden = !profile.previewNote;
  note.textContent = profile.previewNote || '';
  document.getElementById('setup-eyebrow').textContent = `Jet Lag: The Game · ${profile.name}`;
  document.getElementById('setup-network').textContent = profile.networkLabel;
  document.getElementById('setup-description').textContent = `The hider picks a secret location on the ${profile.networkLabel} rail network, including suburban stations. Seekers eliminate zones by asking questions.`;
}
function renderCityProfile(){
  renderSetupProfile(ACTIVE_CITY);
  if(!IS_GAME_SESSION) cityPicker = new CityPicker(document.getElementById('city-picker'), {profiles:CITY_PROFILES, selectedId:ACTIVE_CITY.id, onSelect:selectCity});
  document.querySelectorAll('[data-city-network-title]').forEach(el => {el.textContent = `Jet Lag · ${ACTIVE_CITY.networkLabel}`;});
  document.getElementById('setup-status-text').textContent = `Loading ${ACTIVE_CITY.networkLabel} network data…`;
  const legend = document.getElementById('legend');
  legend.querySelectorAll('.leg-row:not(#leg-status)').forEach(el=>el.remove());
  const status = document.getElementById('leg-status');
  const physicalLines = new Map(ACTIVE_CITY.lines.map(line=>[line.physicalLineId || line.id,line]));
  physicalLines.forEach(line=>{
    const row = document.createElement('div');
    row.className = 'leg-row';
    const swatch = document.createElement('div');
    swatch.className = 'leg-line';
    swatch.style.background = line.color;
    row.append(swatch, document.createTextNode(line.displayLabel || line.label));
    legend.insertBefore(row, status);
  });
}
