// City-specific question definitions. Loaded after the shared question engine.
function isChicagoGame(){ return ACTIVE_CITY.id === 'chicago'; }

function cityQuestionUnavailableReason(question){
  if(isChicagoGame() && question?.type === 'measure' &&
      (question.category === 'A Body of Water' || question.category_label === 'A Body of Water')){
    return 'Body of Water map filtering is not ready: the full water network is too large to process safely on a phone.';
  }
  return null;
}

function validateQuestionForCity(question){
  const unavailable = cityQuestionUnavailableReason(question);
  if(unavailable) throw new Error(unavailable);
  validateQuestionServiceSnapshot(question);
}

function isLinearMeasure(label){
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
  if(question.line_id === 'Purple-Express'){
    throw new Error('Purple Express live confirmation is not connected. Imported claims cannot verify active service.');
  }
  if(question.line_id !== 'Purple-Express' && snapshot.status !== 'static'){
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
  const possible = new Set(line.stops.map(stop => String(stop.id)));
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
  const stops = line.stops.filter(stop => ids.has(String(stop.id)));
  let region = null;
  for(const stop of stops){
    const circle = makeCircle(stop, radiusMiles, 'miles');
    region = region ? turf.union(region, circle) : circle;
  }
  return region ? safeIsect(INIT_POLY, region) : null;
}

let chicagoServiceCalendarPromise = null;
async function resolveChicagoLine(_center, options={}){
  const line = GAME_LINES.find(item => item.id === options.lineId);
  const dataLine = preloadedData.mbta?.lines?.find(item => item.id === options.lineId);
  if(!line || !dataLine) throw new Error('Line data is not available');
  let snapshot = options.serviceSnapshot;
  if(!snapshot && line.id === 'Purple-Express'){
    // No credential is embedded in the static app. Schedule evidence is not live confirmation.
    if(!chicagoServiceCalendarPromise){
      chicagoServiceCalendarPromise = fetchOptionalJSON('data/chicago/service-calendar.json', 'CTA service calendar');
    }
    const calendar = await chicagoServiceCalendarPromise;
    const scheduled = calendar && globalThis.ChicagoService?.snapshot(calendar, line.id);
    const detail = scheduled?.status === 'scheduled-active'
      ? 'The timetable indicates service now, but live confirmation is not connected.'
      : scheduled?.status === 'scheduled-inactive'
        ? 'The timetable indicates no service now.' : 'Current service could not be verified.';
    throw new Error(`Purple Express: ${detail}`);
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
      boundaryHighlightLayer.addTo(map);
    }
  };
}
