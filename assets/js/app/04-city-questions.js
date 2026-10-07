// City-specific question definitions. Loaded after the shared question engine.
function isChicagoGame(){ return ACTIVE_CITY.id === 'chicago'; }

function cityQuestionUnavailableReason(question){
  return null;
}

function validateQuestionForCity(question){
  const unavailable = cityQuestionUnavailableReason(question);
  if(unavailable) throw new Error(unavailable);
  validateAdaptiveLinearQuestion(question);
  validateQuestionServiceSnapshot(question);
}

function isLinearMeasure(label){
  if(ACTIVE_CITY.measureFilters?.[label]?.mode === 'adaptive-linear') return true;
  return ['An Amtrak Line', 'A Coastline', 'Lake Michigan shoreline'].includes(label) ||
    (isChicagoGame() && ['A Body of Water', 'A City Border', 'A Ward Border'].includes(label));
}

async function resolveChicagoBoundary(category, center){
  await loadBoundaryData();
  const match = resolveBoundaryFromPreloaded(category, center);
  if(match) return match;
  if(category === 'ward' || category === 'community_area'){
    const chicago = (getBoundaryDataset('city') || []).find(item =>
      String(item.name || item.properties?.name).toLowerCase() === 'chicago');
    const city = coerceFeature(chicago, 'Chicago');
    if(city && !turf.booleanPointInPolygon(turf.point([center.lng, center.lat]), city)){
      const outside = safeDiff(INIT_POLY, city);
      if(outside) return {val:'Outside Chicago', boundary:outside};
    }
  }
  throw new Error(`No verified ${category.replaceAll('_', ' ')} boundary at this location`);
}

function validateQuestionServiceSnapshot(question){
  if(!isChicagoGame() || question?.type !== 'matching' || question.category !== 'line') return;
  const snapshot = question.service_snapshot;
  if(!snapshot || snapshot.lineId !== question.line_id || !Array.isArray(snapshot.stationIds) ||
      !snapshot.stationIds.length || !Number.isFinite(Date.parse(snapshot.observedAt))){
    throw new Error('Chicago line question is missing its station-service snapshot. Rebuild the question.');
  }
  if(question.line_id === 'Purple-Express') throw new Error('Purple Express is now part of Purple Line. Rebuild this legacy question.');
  if(question.line_id === 'Purple'){
    const calendar=globalThis.ChicagoService?.getCalendar();
    if(!calendar) throw new Error('Purple service schedule is loading. Try again shortly.');
    const replayed=globalThis.ChicagoService.replay(calendar,snapshot);
    if(!replayed || replayed.status!==snapshot.status || JSON.stringify(replayed.stationIds)!==JSON.stringify(snapshot.stationIds)){
      throw new Error('Purple service snapshot does not match its saved schedule or live observation.');
    }
  } else if(snapshot.status !== 'static'){
    throw new Error('Invalid station-service snapshot for this line.');
  }
  if(snapshot.datasetVersion !== ACTIVE_CITY.datasetVersion){
    throw new Error('Line snapshot uses a different dataset version.');
  }
  const line = preloadedData.mbta?.lines?.find(item => item.id === question.line_id);
  if(!line) throw new Error('Load this city’s transit data before importing a line question.');
  if(!snapshot.feedVersion || snapshot.feedVersion !== preloadedData.mbta.feedVersion){
    throw new Error('Line snapshot uses a different CTA source feed. Update both devices to the same dataset.');
  }
  const possible = new Set((question.line_id==='Purple' ? preloadedData.mbta.lines.flatMap(item=>item.stops) : line.stops).map(stop => String(stop.id)));
  if(new Set(snapshot.stationIds).size !== snapshot.stationIds.length ||
      (snapshot.status === 'static' && snapshot.stationIds.length !== possible.size) ||
      snapshot.stationIds.some(id => typeof id !== 'string' || !possible.has(id))){
    throw new Error('Line question contains stations outside this dataset’s line definition.');
  }
}

function validateSavedCityQuestions(save){
  if(!isChicagoGame()) return;
  if(!save.transit_feed_version || save.transit_feed_version !== preloadedData.mbta?.feedVersion){
    throw new Error('Saved game uses a different CTA feed. Restore its dataset or start a new game.');
  }
  const questions = [...(save.constraints || []), ...Object.values(save.outgoingQuestions || {}), save.buildState?.currentBuiltQuestion];
  for(const question of questions){
    if(question) validateQuestionForCity(question);
  }
  const params = save.buildState?.qparams;
  if(params?.matching_cat === 'line' && params.matching_seeker_val){
    validateQuestionServiceSnapshot({type:'matching',category:'line',line_id:params.matching_line_id,service_snapshot:params.matching_service_snapshot});
  }
}

function stationMatchesQuestionLine(station, question){
  if(!isChicagoGame()) return !!question.line_id && station.lines.includes(question.line_id);
  validateQuestionServiceSnapshot(question);
  // Old saved station selections may not have an ID; recover only an exact coordinate match.
  const stationId = station.id || Object.entries(stopLineMap).find(([, item]) =>
    item.lat === station.lat && item.lng === station.lng)?.[0];
  if(!stationId) throw new Error('Select your station again to identify it unambiguously.');
  return question.service_snapshot.stationIds.includes(String(stationId));
}

function lineSnapshotBoundary(snapshot, radiusMiles){
  const ids = new Set(snapshot.stationIds);
  const line = preloadedData.mbta.lines.find(item => item.id === snapshot.lineId);
  const candidates = snapshot.lineId==='Purple' ? preloadedData.mbta.lines.flatMap(item=>item.stops) : line.stops;
  const stops = [...new Map(candidates.filter(stop => ids.has(String(stop.id))).map(stop=>[String(stop.id),stop])).values()];
  let region = null;
  for(const stop of stops){
    const circle = makeCircle(stop, radiusMiles, 'miles');
    region = region ? turf.union(region, circle) : circle;
  }
  return region ? safeIsect(INIT_POLY, region) : null;
}

let chicagoServiceCalendarPromise = null;
function loadChicagoServiceCalendar(){
  if(!chicagoServiceCalendarPromise){
    chicagoServiceCalendarPromise=fetchOptionalJSON('data/chicago/service-calendar.json','CTA service calendar')
      .then(data=>globalThis.ChicagoService?.setCalendar(data));
  }
  return chicagoServiceCalendarPromise;
}
// Eagerly load the small saved timetable so incoming hider questions validate offline after startup.
if(IS_GAME_SESSION && isChicagoGame() && typeof fetch==='function') loadChicagoServiceCalendar();
async function resolveChicagoLine(_center, options={}){
  const line = GAME_LINES.find(item => item.id === options.lineId);
  const dataLine = preloadedData.mbta?.lines?.find(item => item.id === options.lineId);
  if(!line || !dataLine) throw new Error('Line data is not available');
  let snapshot = options.serviceSnapshot;
  if(line.id==='Purple'){
    const calendar=await loadChicagoServiceCalendar();
    if(!calendar || calendar.feedVersion!==preloadedData.mbta.feedVersion) throw new Error('Purple timetable is missing or belongs to another CTA feed.');
    if(!snapshot){
      const observedAt=options.observedAt || new Date().toISOString();
      snapshot=globalThis.ChicagoService.snapshot(calendar,'Purple',observedAt);
      // Deployment may configure a same-origin server proxy. Never put an API key in this page.
      const configured=globalThis.CHICAGO_CTA_TRIP_UPDATES_URL ?? '/api/cta/trip-updates';
      if(configured){
        try{
          const url=new URL(configured,window.location.href);
          if(url.origin!==window.location.origin)throw new Error('CTA live proxy must be same origin');
          const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
          try{
            const response=await fetch(url.href,{signal:controller.signal,cache:'no-store'});
            if(!response.ok)throw new Error('CTA live feed unavailable');
            snapshot=globalThis.ChicagoService.withRealtime(calendar,await response.json(),observedAt);
          }finally{clearTimeout(timer);}
        }catch(error){snapshot.fallbackReason='live-unavailable';}
      }else snapshot.fallbackReason='live-not-connected';
      if(snapshot.status==='unknown'||!snapshot.stationIds.length) throw new Error('Purple has no verified scheduled service at this time, or its saved timetable has expired.');
      snapshot.datasetVersion=ACTIVE_CITY.datasetVersion;
      toast(snapshot.source==='cta-gtfs-schedule'?'Purple membership uses the saved CTA timetable; live service is not verified.':'Purple membership uses current CTA observations with the saved timetable.');
    }
  }
  if(!snapshot){
    snapshot = {
      lineId:line.id,
      observedAt:new Date().toISOString(),
      source:'cta-gtfs-network',
      status:'static',
      stationIds:[...new Set(dataLine.stops.map(stop => String(stop.id)))],
      datasetVersion:ACTIVE_CITY.datasetVersion,
      feedVersion:preloadedData.mbta.feedVersion,
    };
  }
  validateQuestionServiceSnapshot({type:'matching', category:'line', line_id:line.id, service_snapshot:snapshot});
  return {
    val:line.label,
    line_id:line.id,
    service_snapshot:cloneForStorage(snapshot),
    boundary:lineSnapshotBoundary(snapshot, options.hideRadiusMiles ?? hideRadiusMi),
  };
}

if(isChicagoGame()){
  const line = MATCHING_CATS.find(item => item.cat === 'line');
  line.label = 'CTA Line';
  line.resolve = resolveChicagoLine;
  const landmass = MATCHING_CATS.find(item => item.cat === 'landmass');
  const makeBoundary = (cat, label, icon) => ({cat,label,icon,resolve:center => resolveChicagoBoundary(cat, center)});
  MATCHING_CATS.splice(0, MATCHING_CATS.length, line, landmass,
    makeBoundary('city', 'City / Municipality', '🏙️'),
    makeBoundary('ward', 'Ward', '🏛️'),
    makeBoundary('community_area', 'Community Area', '🏘️'),
    makeBoundary('postcode', 'ZIP Code (ZCTA)', '📮'));

  MEASURE_CATS.find(item => item.label === 'Sea Level').label = 'Elevation';
  MEASURE_CATS.find(item => item.label === 'A Coastline').label = 'Lake Michigan shoreline';
  const countyBorder = MEASURE_CATS.find(item => item.label === 'A County Border');
  countyBorder.label = 'A Ward Border';

  // Strict local datasets: a missing Chicago source must never trigger a Boston or generic fallback.
  for(const category of [...MEASURE_CATS, ...NEAREST_CATS, ...TENTACLES_CATS]){
    if(category.label === 'A Commuter Rail Station'){
      category.instances = async () => commuterRailStopsList;
    } else {
      category.instances = async () => {
        await loadPoiData();
        const values = getNamedPoiCollection(category.label);
        if(!values.length) throw new Error(`Verified Chicago ${category.label} data is not available yet`);
        return values;
      };
    }
    delete category.overpass;
  }

  const sharedLinearFeatures = getMeasureLinearFeatures;
  getMeasureLinearFeatures = async function(category, center){
    if(category.label === 'A City Border' || category.label === 'A Ward Border'){
      await loadBoundaryData();
      const key = category.label === 'A Ward Border' ? 'ward' : 'city';
      return (getBoundaryDataset(key) || []).flatMap(item =>
        featureToDisplayLines(coerceFeature(item, item.name)).map(feature => ({...feature, name:item.name})));
    }
    await loadPoiData();
    const keys = {
      'Lake Michigan shoreline':'coastlineLines',
      'A Body of Water':'bodiesOfWaterLines',
      'An Amtrak Line':'amtrakLines',
    };
    if(keys[category.label]) return preloadedData.pois?.[keys[category.label]] || [];
    return sharedLinearFeatures(category, center);
  };

  const sharedHighlight = highlightBoundary;
  highlightBoundary = function(category){
    const key = category === 'A Ward Border' ? 'ward' : category === 'A City Border' ? 'city' : category;
    if(!['ward','community_area','postcode','city'].includes(key)) return sharedHighlight(category);
    if(!boundaryHighlightLayer) return;
    boundaryHighlightLayer.clearLayers();
    boundaryHighlightLayer.remove();
    const features = (getBoundaryDataset(key) || []).map(item => coerceFeature(item, item.name)).filter(Boolean);
    if(features.length){
      boundaryHighlightLayer.addData({type:'FeatureCollection', features});
      boundaryHighlightLayer.setStyle(feature => {
        const selected = qparams.center && turf.booleanPointInPolygon(
          turf.point([qparams.center.lng, qparams.center.lat]), feature);
        return selected
          ? {color:'#d48b25', weight:2.5, opacity:0.95, fill:false}
          : {color:'#788b98', weight:0.8, opacity:0.35, fill:false};
      });
      boundaryHighlightLayer.addTo(map);
    }
  };
}
