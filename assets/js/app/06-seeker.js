//  SEEKER: APPLY ANSWER
// ========================================================
let _pendingResultAction = null;

function isLatLngLike(value){
  return Number.isFinite(Number(value?.lat)) && Number.isFinite(Number(value?.lng));
}

function normalizeLatLng(value){
  if(!isLatLngLike(value)) return null;
  return {lat:Number(value.lat), lng:Number(value.lng)};
}

function normalizeMatchingBoundaryForCenter(boundary, center){
  if(!boundary || !center) return boundary || null;
  try{
    const pt = turf.point([center.lng, center.lat]);
    let normalized = boundary;
    if(!turf.booleanPointInPolygon(pt, normalized)){
      const bbox = turf.bboxPolygon([-72.5, 41.5, -70.0, 43.0]);
      const flipped = turf.difference(bbox, normalized);
      if(flipped && turf.booleanPointInPolygon(pt, flipped)){
        normalized = flipped;
      }
    }
    return turf.simplify(normalized, {tolerance:0.0005, highQuality:false}) || normalized;
  }catch(e){
    return boundary;
  }
}

function buildStoredQuestionBase(payload, type){
  if(!payload?.id) throw new Error('Question is missing an id');
  if(payload.type !== type) throw new Error(`Expected a ${type} question`);
}

function buildStoredRadarQuestion(payload){
  buildStoredQuestionBase(payload, 'radar');
  const center = normalizeLatLng(payload.center);
  const radius = Number(payload.radius_miles);
  if(!center || !Number.isFinite(radius)) throw new Error('Radar question is missing center or radius');
  return {id:payload.id, ...QDEFS.radar.toJSON({center, radius_miles:radius})};
}

function buildStoredThermoQuestion(payload){
  buildStoredQuestionBase(payload, 'thermo');
  const center = normalizeLatLng(payload.center);
  const dest = normalizeLatLng(payload.thermo_dest);
  const travelMiles = Number(payload.travel_miles);
  if(!center || !dest || !Number.isFinite(travelMiles)) throw new Error('Thermometer question is missing its points');
  return {id:payload.id, ...QDEFS.thermo.toJSON({center, thermo_dest:dest, travel_miles:travelMiles})};
}

async function buildStoredTentaclesQuestion(payload){
  buildStoredQuestionBase(payload, 'tentacles');
  const center = normalizeLatLng(payload.center);
  if(!center) throw new Error('Tentacles question is missing center');
  const radius = Number(payload.radius_miles || 1);
  let options = Array.isArray(payload.options)
    ? payload.options
        .map((opt, i) => normalizeTentacleOption(opt, i))
        .filter(Boolean)
    : [];
  if(options.length < 2){
    const categoryLabel = String(payload.category_label || payload.category || '').trim();
    if(!categoryLabel) throw new Error('Tentacles question is missing category');
    options = await resolveTentacleQuestionOptions(categoryLabel, center, radius);
  }
  if(options.length < 2) throw new Error('Tentacles question needs at least two options');
  const categoryLabel = payload.category_label || payload.category || null;
  return {
    id:payload.id,
    ...QDEFS.tentacles.toJSON({
      center,
      radius_miles:radius,
      tentacle_options:options,
      _tcat:categoryLabel,
      _tcatlabel:categoryLabel,
      tentacles_cat_label:categoryLabel,
    })
  };
}

function buildStoredPhotoQuestion(payload){
  buildStoredQuestionBase(payload, 'photo');
  const prompt = String(payload.prompt || '').trim();
  if(!prompt) throw new Error('Photo question is missing its prompt');
  return {id:payload.id, ...QDEFS.photo.toJSON({photo_prompt:prompt})};
}

function buildStoredMatchingQuestion(payload){
  buildStoredQuestionBase(payload, 'matching');
  const center = normalizeLatLng(payload.center);
  const category = payload.category || payload.category_label;
  const categoryLabel = payload.category_label || category;
  if(!center || !category) throw new Error('Matching question is missing center or category');
  if(category === 'line' && !payload.boundary_geojson) return null;
  if(!payload.seeker_val && !('boundary_geojson' in payload)) return null;
  const boundary = category === 'line'
    ? (payload.boundary_geojson || null)
    : normalizeMatchingBoundaryForCenter(payload.boundary_geojson || null, center);
  return {
    id:payload.id,
    ...QDEFS.matching.toJSON({
      center,
      matching_cat:category,
      matching_cat_label:categoryLabel,
      matching_seeker_val:payload.seeker_val || 'Unknown',
      matching_line_id:payload.line_id || null,
      matching_hide_radius_miles:Number(payload.hide_radius_miles || hideRadiusMi),
      matching_boundary:boundary,
      _matching_boundary_simplified:boundary,
    }),
  };
}

async function rebuildMatchingQuestion(payload){
  buildStoredQuestionBase(payload, 'matching');
  const center = normalizeLatLng(payload.center);
  const category = payload.category || payload.category_label;
  const catObj = MATCHING_CATS.find(c => c.cat === category);
  if(!center || !catObj) throw new Error('Unknown matching category');
  if(category === 'line' && !payload.line_id) throw new Error('Line matching question is missing line id');
  const result = await catObj.resolve(center, {
    lineId: payload.line_id || null,
    hideRadiusMiles: Number(payload.hide_radius_miles || hideRadiusMi),
  });
  if(!result?.val) throw new Error(`Could not resolve ${payload.category_label || catObj.label}`);
  const boundary = category === 'line'
    ? (result.boundary || null)
    : normalizeMatchingBoundaryForCenter(result.boundary || null, center);
  return {
    id:payload.id,
    ...QDEFS.matching.toJSON({
      center,
      matching_cat:catObj.cat,
      matching_cat_label:payload.category_label || catObj.label,
      matching_seeker_val:result.val,
      matching_line_id:payload.line_id || result.line_id || null,
      matching_hide_radius_miles:Number(payload.hide_radius_miles || hideRadiusMi),
      matching_boundary:boundary,
      _matching_boundary_simplified:boundary,
    }),
  };
}

function buildStoredNearestQuestion(payload){
  buildStoredQuestionBase(payload, 'nearest');
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const seekerPoiPoint = normalizeLatLng(payload.seeker_poi);
  const allPois = Array.isArray(payload.all_pois)
    ? payload.all_pois
        .map(poi => {
          const point = normalizeLatLng(poi);
          return point ? {name:String(poi?.name || categoryLabel || 'POI'), ...point} : null;
        })
        .filter(Boolean)
    : [];
  if(!center || !categoryLabel || !seekerPoiPoint) return null;
  return {
    id:payload.id,
    ...QDEFS.nearest.toJSON({
      center,
      nearest_cat:categoryLabel,
      nearest_cat_label:categoryLabel,
      nearest_seeker_poi:{name:String(payload.seeker_poi?.name || categoryLabel), ...seekerPoiPoint},
      nearest_all_pois:allPois,
      nearest_voronoi:payload.voronoi_geojson || null,
    }),
  };
}

async function rebuildNearestQuestion(payload){
  buildStoredQuestionBase(payload, 'nearest');
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const catObj = NEAREST_CATS.find(c => c.label === categoryLabel);
  if(!center || !catObj) throw new Error('Unknown nearest category');
  const pois = await getCategoryInstances(catObj, center, 35000);
  if(!pois.length) throw new Error(`No ${categoryLabel} found nearby`);
  pois.sort((a,b)=>turfDist(center,a)-turfDist(center,b));
  const nearest = pois[0];
  let voronoi = null;
  if(pois.length >= 2){
    try{
      const fc = turf.featureCollection(pois.map(p=>turf.point([p.lng,p.lat])));
      const cells = turf.voronoi(fc, {bbox:[-72,41.5,-70,43]});
      if(cells?.features?.length){
        const nearestPt = turf.point([nearest.lng, nearest.lat]);
        const seekerPt = turf.point([center.lng, center.lat]);
        const correctCell = cells.features.find(cell=>{
          try{ return turf.booleanPointInPolygon(nearestPt, cell); }catch(e){ return false; }
        });
        if(correctCell){
          try{
            if(turf.booleanPointInPolygon(seekerPt, correctCell)) voronoi = correctCell;
          }catch(e){}
        }
      }
    }catch(e){}
  }
  return {
    id:payload.id,
    ...QDEFS.nearest.toJSON({
      center,
      nearest_cat:catObj.label,
      nearest_cat_label:payload.category_label || catObj.label,
      nearest_seeker_poi:nearest,
      nearest_all_pois:pois.slice(0,20),
      nearest_voronoi:voronoi,
    }),
  };
}

function buildStoredMeasureQuestion(payload){
  buildStoredQuestionBase(payload, 'measure');
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const mode = payload.mode || (isSeaLevelMeasure(categoryLabel) ? 'elevation' : 'distance');
  if(!center || !categoryLabel) throw new Error('Measure question is missing center or category');
  if(mode === 'elevation'){
    const seekerFeet = Number(payload.seeker_elevation_ft);
    if(!Number.isFinite(seekerFeet)) return null;
    return {
      id:payload.id,
      ...QDEFS.measure.toJSON({
        center,
        measure_mode:'elevation',
        measure_cat:categoryLabel,
        measure_cat_label:categoryLabel,
        measure_seeker_elevation_ft:seekerFeet,
        measure_seeker_elevation_m:Number(payload.seeker_elevation_m) || (seekerFeet * 0.3048),
      }),
    };
  }
  const seekerDist = Number(payload.seeker_dist);
  const seekerNearestPoint = normalizeLatLng(payload.seeker_nearest);
  const seekerNearest = seekerNearestPoint
    ? {name:String(payload.seeker_nearest?.name || categoryLabel), ...seekerNearestPoint}
    : null;
  const allInstances = Array.isArray(payload.all_instances)
    ? payload.all_instances
        .map(p => {
          const point = normalizeLatLng(p);
          return point ? {name:String(p?.name || categoryLabel), ...point} : null;
        })
        .filter(Boolean)
    : [];
  const linearFeatures = Array.isArray(payload.linear_features) ? payload.linear_features.filter(item => item?.geometry) : [];
  if(!Number.isFinite(seekerDist) || (!allInstances.length && !linearFeatures.length)) return null;
  return {
    id:payload.id,
    ...QDEFS.measure.toJSON({
      center,
      measure_mode:'distance',
      measure_cat:categoryLabel,
      measure_cat_label:categoryLabel,
      measure_seeker_nearest:seekerNearest,
      measure_seeker_dist:seekerDist,
      measure_all_instances:allInstances,
      measure_linear_features:linearFeatures,
    }),
  };
}

async function rebuildMeasureQuestion(payload){
  buildStoredQuestionBase(payload, 'measure');
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const catObj = MEASURE_CATS.find(c => c.label === categoryLabel);
  if(!center || !catObj) throw new Error('Unknown measure category');

  if(isSeaLevelMeasure(categoryLabel) || payload.mode === 'elevation'){
    const grid = await loadElevationData();
    if(!grid?.values?.length) throw new Error('No elevation grid data available');
    const elevation = await fetchPointElevation(center.lat, center.lng);
    return {
      id:payload.id,
      ...QDEFS.measure.toJSON({
        center,
        measure_mode:'elevation',
        measure_cat:catObj.label,
        measure_cat_label:payload.category_label || catObj.label,
        measure_seeker_elevation_ft:elevation.feet,
        measure_seeker_elevation_m:elevation.meters,
      }),
    };
  }

  if(['An Amtrak Line','A Coastline'].includes(catObj.label)){
    const lineFeatures = (await getMeasureLinearFeatures(catObj, center))
      .map(item => ({name:item.name, feature:coerceFeature(item, item.name)}))
      .filter(item => item.feature);
    if(!lineFeatures.length) throw new Error(`No ${catObj.label} geometry found`);

    const seekerPoint = turf.point([center.lng, center.lat]);
    let best = null;
    lineFeatures.forEach(item => {
      try{
        const snapped = turf.nearestPointOnLine(item.feature, seekerPoint, {units:'miles'});
        const dist = snapped?.properties?.dist;
        if(!Number.isFinite(dist)) return;
        if(!best || dist < best.dist){
          const [lng, lat] = snapped.geometry.coordinates;
          best = {name:item.name, lat, lng, dist};
        }
      }catch(e){}
    });
    if(!best) throw new Error(`Could not resolve ${catObj.label}`);

    return {
      id:payload.id,
      ...QDEFS.measure.toJSON({
        center,
        measure_mode:'distance',
        measure_cat:catObj.label,
        measure_cat_label:payload.category_label || catObj.label,
        measure_seeker_nearest:{lat:best.lat,lng:best.lng,name:best.name},
        measure_seeker_dist:best.dist,
        measure_all_instances:[{lat:best.lat,lng:best.lng,name:best.name}],
        measure_linear_features:lineFeatures.map(item => ({
          name:item.name,
          geometry:item.feature.geometry,
        })),
      }),
    };
  }

  const instances = await getCategoryInstances(catObj, center, 35000);
  if(!instances.length) throw new Error(`No ${catObj.label} found nearby`);
  instances.sort((a,b)=>turfDist(center,a)-turfDist(center,b));
  const nearest = instances[0];
  return {
    id:payload.id,
    ...QDEFS.measure.toJSON({
      center,
      measure_mode:'distance',
      measure_cat:catObj.label,
      measure_cat_label:payload.category_label || catObj.label,
      measure_seeker_nearest:nearest,
      measure_seeker_dist:turfDist(center, nearest),
      measure_all_instances:instances.slice(0,200),
      measure_linear_features:[],
    }),
  };
}

async function hydrateOutgoingQuestion(payload){
  if(!payload || typeof payload !== 'object') throw new Error('JSON must be an object');
  if(payload.answer) throw new Error('Paste the original question JSON, not the answer');
  if(payload.type === 'veto' || payload.type === 'randomize_card') throw new Error('Card results are not loadable questions');
  if(!payload.type) throw new Error('Question is missing a type');

  switch(payload.type){
    case 'radar': return buildStoredRadarQuestion(payload);
    case 'thermo': return buildStoredThermoQuestion(payload);
    case 'tentacles': return await buildStoredTentaclesQuestion(payload);
    case 'photo': return buildStoredPhotoQuestion(payload);
    case 'matching': return buildStoredMatchingQuestion(payload) || await rebuildMatchingQuestion(payload);
    case 'nearest': return buildStoredNearestQuestion(payload) || await rebuildNearestQuestion(payload);
    case 'measure': return buildStoredMeasureQuestion(payload) || await rebuildMeasureQuestion(payload);
    default:
      throw new Error(`Unsupported question type: ${payload.type}`);
  }
}

async function loadQuestionFromRaw(raw, onSuccess){
  let payload;
  try{
    payload = JSON.parse(raw);
  }catch(e){
    toast('Invalid JSON - check format');
    return;
  }

  try{
    toast('Loading question context...', 3200);
    const question = await hydrateOutgoingQuestion(payload);
    rememberOutgoingQuestion(question);
    saveGame();
    onSuccess(question);
  }catch(e){
    toast(`Could not load question: ${e.message}`);
  }
}

function loadQuestionInline(){
  const raw = document.getElementById('json-question-in-inline').value.trim();
  if(!raw){ toast('Paste a question JSON first'); return; }
  loadQuestionFromRaw(raw, (question)=>{
    document.getElementById('json-question-in-inline').value = '';
    loadQuestionIntoBuild(question);
    toast(`${QDEFS[question.type]?.label || question.type} question loaded`);
  });
}

function questionToBuildParams(question){
  const base = {radius_miles:1, travel_miles:0.5};
  switch(question.type){
    case 'radar':
      return {
        ...base,
        center:question.center,
        radius_miles:question.radius_miles,
      };
    case 'thermo':
      return {
        ...base,
        center:question.center,
        travel_miles:question.travel_miles,
        thermo_dest:question.thermo_dest,
      };
    case 'measure':
      return {
        ...base,
        center:question.center,
        measure_cat:question.category,
        measure_cat_label:question.category_label,
        measure_mode:question.mode || 'distance',
        measure_seeker_nearest:question.seeker_nearest || null,
        measure_seeker_dist:question.seeker_dist ?? null,
        measure_seeker_elevation_ft:question.seeker_elevation_ft ?? null,
        measure_seeker_elevation_m:question.seeker_elevation_m ?? null,
        measure_all_instances:question.all_instances || [],
        measure_linear_features:question.linear_features || [],
        measure_constraint_union:question._constraint_union || null,
      };
    case 'tentacles':
      return {
        ...base,
        center:question.center,
        radius_miles:question.radius_miles || 1,
        _tcat:question.category_label || question.category || null,
        _tcatlabel:question.category_label || question.category || null,
        tentacles_cat_label:question.category_label || question.category || null,
        tentacle_options:question.options || [],
      };
    case 'matching':
      return {
        ...base,
        _matching_mode:'matching',
        center:question.center,
        matching_cat:question.category,
        matching_cat_label:question.category_label,
        matching_seeker_val:question.seeker_val,
        matching_line_id:question.line_id || null,
        matching_line_label:question.seeker_val || null,
        matching_hide_radius_miles:question.hide_radius_miles ?? hideRadiusMi,
        matching_boundary:question.boundary_geojson || null,
        _matching_boundary_simplified:question.boundary_geojson || null,
      };
    case 'nearest':
      return {
        ...base,
        _matching_mode:'nearest',
        center:question.center,
        nearest_cat:question.category_label || question.category,
        nearest_cat_label:question.category_label || question.category,
        nearest_seeker_poi:question.seeker_poi,
        nearest_all_pois:question.all_pois || [],
        nearest_voronoi:question.voronoi_geojson || null,
      };
    case 'photo':
      return {
        ...base,
        photo_prompt:question.prompt || '',
      };
    default:
      return base;
  }
}

function presetToBuildParams(preset){
  const base = {radius_miles:1, travel_miles:0.5};
  switch(preset?.build_qtype){
    case 'radar':
      return {
        ...base,
        radius_miles:preset.radius_miles,
      };
    case 'thermo':
      return {
        ...base,
        travel_miles:preset.travel_miles,
      };
    case 'measure':
      return {
        ...base,
        _mcat:preset.category_label,
        _mcatlabel:preset.category_label,
        measure_cat:preset.category,
        measure_cat_label:preset.category_label,
      };
    case 'tentacles':
      return {
        ...base,
        radius_miles:preset.radius_miles || 1,
        _tcat:preset.category_label,
        _tcatlabel:preset.category_label,
        tentacles_cat_label:preset.category_label,
      };
    case 'matching':
      if(preset.mode === 'nearest'){
        return {
          ...base,
          _matching_mode:'nearest',
          nearest_cat:preset.category,
          nearest_cat_label:preset.category_label,
        };
      }
      return {
        ...base,
        _matching_mode:'matching',
        matching_cat:preset.category,
        matching_cat_label:preset.category_label,
        matching_line_id:preset.line_id || null,
        matching_line_label:preset.seeker_val || null,
        matching_hide_radius_miles:preset.hide_radius_miles ?? hideRadiusMi,
      };
    case 'photo':
      return {
        ...base,
        photo_prompt:preset.prompt || '',
      };
    default:
      return base;
  }
}

function syncLoadedQuestionHighlights(question){
  if(question.type === 'matching'){
    highlightBoundary(question.category);
    return;
  }
  if(question.type === 'measure'){
    if(question.category_label === 'A County Border') highlightBoundary('county');
    else if(question.category_label === 'A City Border') highlightBoundary('city');
    else clearBoundaryHighlight();
    return;
  }
  clearBoundaryHighlight();
}

function setLoadQuestionPanelOpen(open){
  const panel = document.getElementById('load-question-panel');
  const btn = document.getElementById('load-question-toggle');
  if(!panel || !btn) return;
  panel.style.display = open ? 'block' : 'none';
  btn.textContent = open ? 'Hide Existing Question Loader' : 'Load Existing Question';
}

function toggleLoadQuestionPanel(){
  const panel = document.getElementById('load-question-panel');
  if(!panel) return;
  setLoadQuestionPanelOpen(panel.style.display === 'none');
}

function loadQuestionIntoBuild(question){
  qtype = question.type === 'nearest' ? 'matching' : question.type;
  qparams = questionToBuildParams(question);
  currentBuiltQuestion = cloneForStorage(question);
  pickStepDefs = QDEFS[qtype]?.pickSteps || [];
  pickStep = pickStepDefs.length ? pickStepDefs.length : -1;
  _simulActive = null;

  clearMarkers();
  previewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  if(typeof setPreviewMapMode === 'function') setPreviewMapMode(false);
  hideBanner();
  syncLoadedQuestionHighlights(question);

  document.querySelectorAll('.qbtn').forEach(b=>b.classList.toggle('on', b.dataset.q===qtype));
  document.getElementById('panel').classList.remove('collapsed');

  renderBuildBody();
  updatePreview();

  const packet = buildQuestionPacket(question);
  document.getElementById('json-out').value = JSON.stringify(packet, null, 2);
  document.getElementById('json-out-section').style.display = 'block';
  renderSimulBtns(packet);
  renderDirectApplyBtns(packet);
  setLoadQuestionPanelOpen(false);
}

function loadRandomizedPresetIntoBuild(preset){
  if(!preset?.build_qtype) return;
  selectQType(preset.build_qtype);
  qparams = {
    ...qparams,
    ...presetToBuildParams(preset),
  };
  currentBuiltQuestion = null;
  renderBuildBody();
  updatePreview();
  if(typeof maybeAutoResolveBuildQuestion === 'function') maybeAutoResolveBuildQuestion();
  tryGenerate();
}

function getSerializableBuildState(){
  if(!qtype) return null;
  return {
    qtype,
    qparams: cloneForStorage(qparams),
    pickStep,
    currentBuiltQuestion: currentBuiltQuestion ? cloneForStorage(currentBuiltQuestion) : null,
  };
}

function syncRestoredBuildUi(){
  document.querySelectorAll('.qbtn').forEach(b=>b.classList.toggle('on', b.dataset.q===qtype));
  if(typeof syncLoadedQuestionHighlights === 'function'){
    if(currentBuiltQuestion) syncLoadedQuestionHighlights(currentBuiltQuestion);
    else if(qtype === 'matching' && qparams.matching_cat) highlightBoundary(qparams.matching_cat);
    else if(qtype === 'measure'){
      if(qparams.measure_cat_label === 'A County Border' || qparams.measure_cat === 'A County Border') highlightBoundary('county');
      else if(qparams.measure_cat_label === 'A City Border' || qparams.measure_cat === 'A City Border') highlightBoundary('city');
      else clearBoundaryHighlight();
    } else {
      clearBoundaryHighlight();
    }
  }

  if(pickStep >= 0 && pickStep < pickStepDefs.length){
    showBanner(pickStepDefs[pickStep].label);
    document.getElementById('panel').classList.add('collapsed');
  } else {
    hideBanner();
    document.getElementById('panel').classList.remove('collapsed');
  }

  renderBuildBody();
  updatePreview();

  if(currentBuiltQuestion){
    const packet = buildQuestionPacket(currentBuiltQuestion);
    document.getElementById('json-out').value = JSON.stringify(packet, null, 2);
    document.getElementById('json-out-section').style.display = 'block';
    renderSimulBtns(packet);
    renderDirectApplyBtns(packet);
  } else {
    document.getElementById('json-out-section').style.display = 'none';
    document.getElementById('map-simul-bar').classList.remove('visible');
  }
}

function restoreSerializableBuildState(state){
  if(!state?.qtype || !QDEFS[state.qtype]) return;
  qtype = state.qtype;
  qparams = state.qparams || {radius_miles:1, travel_miles:0.5};
  pickStepDefs = QDEFS[qtype]?.pickSteps || [];
  pickStep = Number.isInteger(state.pickStep) ? state.pickStep : -1;
  currentBuiltQuestion = state.currentBuiltQuestion ? cloneForStorage(state.currentBuiltQuestion) : null;
  _simulActive = null;
  clearMarkers();
  previewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  if(typeof setPreviewMapMode === 'function') setPreviewMapMode(false);
  syncRestoredBuildUi();
  if(typeof maybeAutoResolveBuildQuestion === 'function') maybeAutoResolveBuildQuestion();
}

function resolveAnsweredQuestion(payload){
  if(payload.type === 'veto' || payload.type === 'randomize_card') return payload;
  if(!payload?.answer){ return null; }
  if(payload.type){
    const def = QDEFS[payload.type];
    const extraKeys = Object.keys(payload).filter(k => !['id','type','answer','answer_label'].includes(k));
    if(def && extraKeys.length) return payload;
  }
  if(!payload.id) return null;
  const base = (currentBuiltQuestion && currentBuiltQuestion.id === payload.id)
    ? cloneForStorage(currentBuiltQuestion)
    : getOutgoingQuestion(payload.id);
  if(!base) return null;
  const extras = {...payload};
  delete extras.id;
  delete extras.answer;
  return {...base, answer: payload.answer, ...extras};
}

function applyAnswerObject(q, onSuccess){
  // Veto
  if(q.type === 'veto'){
    constraints.push({type:'_veto', _label:'Veto card played - question nullified'});
    renderLog();
    saveGame();
    onSuccess();
    showResult(
      '🚫',
      'Question Vetoed!',
      'The hider played their Veto card. This question is nullified - no zone change.',
      null,
      null
    );
    return;
  }

  // Randomize card - seekers must now build the specified question type and send to hider
  if(q.type === 'randomize_card'){
    const preset = q.preset || null;
    const label = preset?.label || (q.question_type ? (QDEFS[q.question_type]?.label || q.question_type) : 'Random question');
    constraints.push({
      type:'_randomize_card',
      _qtype: preset?.question_type || q.question_type,
      _preset_label: label,
      _label:`Randomize card - preloaded question: ${label}`,
    });
    renderLog();
    saveGame();
    onSuccess();
    if(preset) loadRandomizedPresetIntoBuild(preset);
    _pendingResultAction = () => switchTab('build');
    showResult(
      '🎲',
      'Randomize Card!',
      'The hider played their Randomize card. A randomized question has been preloaded in Ask and is ready for you to finish.',
      `<div><b>${label}</b></div>`,
      null
    );
    return;
  }

  // Normal answered question
  if(!q.answer){ toast('Missing "answer" field'); return; }
  const def = QDEFS[q.type];
  if(!def){ toast(`Unknown type: "${q.type}"`); return; }
  try{
    const nz = def.applyToZone(validZone, q);
    if(!nz){ toast('Zone empty - contradiction?'); return; }
    validZone = nz;
    constraints.push(q);
    forgetOutgoingQuestion(q.id);
    renderZone();
    renderLog();
    saveGame();
    onSuccess();
    toast('Zone updated ✓');
  }catch(e){
    toast('Error: ' + e.message);
  }
}

function applyAnswer(){
  const raw = document.getElementById('json-in').value.trim();
  if(!raw){ toast('Paste an answered JSON first'); return; }
  applyAnswerFromRaw(raw, ()=>{ document.getElementById('json-in').value=''; switchTab('log'); });
}

function applyAnswerFromRaw(raw, onSuccess){
  let payload;
  try{
    payload = JSON.parse(raw);
  }catch(e){
    toast('Invalid JSON - check format');
    return;
  }
  const q = resolveAnsweredQuestion(payload);
  if(!q){
    toast(payload?.id
      ? 'Original question data not found on this device'
      : 'Invalid answer JSON - missing question context');
    return;
  }
  applyAnswerObject(q, onSuccess);
}

function showResult(emoji, title, sub, qboxHTML, autoSelectType=null){
  document.getElementById('ro-emoji').textContent = emoji;
  document.getElementById('ro-title').textContent = title;
  document.getElementById('ro-sub').textContent   = sub;

  const qb = document.getElementById('ro-qbox');
  if(qboxHTML){
    qb.innerHTML = qboxHTML;
    qb.style.display = 'block';
  } else {
    qb.style.display = 'none';
  }

  const pill = document.getElementById('ro-qtype-pill');
  if(autoSelectType){
    const def = QDEFS[autoSelectType];
    document.getElementById('ro-qtype-icon').textContent = QICONS[autoSelectType] || '❓';
    document.getElementById('ro-qtype-name').textContent = def ? def.label : autoSelectType;
    document.getElementById('ro-qtype-desc').textContent = QDESC[autoSelectType] || '';
    pill.style.display = 'block';
  } else {
    pill.style.display = 'none';
  }

  document.getElementById('ro-cta-btn').textContent = autoSelectType ? 'Build This Question →' : 'Got it →';
  document.getElementById('result-overlay').classList.remove('hidden');
}

function closeResult(){
  document.getElementById('result-overlay').classList.add('hidden');
  if(_pendingResultAction){
    const action = _pendingResultAction;
    _pendingResultAction = null;
    action();
  } else if(_pendingRandomizeType){
    const t = _pendingRandomizeType;
    _pendingRandomizeType = null;
    switchTab('build');
    selectQType(t);
  } else {
    switchTab('log');
  }
}

function renderLog(){
  const el = document.getElementById('log-list');
  if(!constraints.length){
    el.innerHTML = '<p class="empty">No constraints applied yet.</p>';
    return;
  }
  el.innerHTML = constraints.map((q, idx) => {
    const canDelete = q.type !== '_setup';
    const delBtn = canDelete
      ? `<button class="cdelete" onclick="deleteConstraintAt(${idx})" title="Delete and recompute zone">✕</button>`
      : '';
    if(q.type === '_setup'){
      return `<div class="citem"><span class="ctag" style="background:rgba(240,160,48,0.2);color:var(--gold)">SETUP</span><div class="cdesc"><b>${q._label}</b></div>${delBtn}</div>`;
    }
    if(q.type === '_veto'){
      return `<div class="citem"><span class="ctag" style="background:rgba(232,64,64,0.15);color:var(--accent)">VETO</span><div class="cdesc"><b>Question vetoed - no info gained</b></div>${delBtn}</div>`;
    }
    if(q.type === '_randomize_card'){
      const def = QDEFS[q._qtype];
      return `<div class="citem"><span class="ctag" style="background:rgba(160,96,255,0.2);color:var(--purple)">RANDOM</span><div class="cdesc"><b>Randomize card played</b> - preloaded question: <b>${q._preset_label || (def ? def.label : q._qtype)}</b></div>${delBtn}</div>`;
    }
    const def = QDEFS[q.type];
    return `<div class="citem"><span class="ctag ${def ? def.colorTag : 'tag-radar'}">${def ? def.label : q.type}</span><div class="cdesc">${def ? def.describe(q) : JSON.stringify(q)}</div>${delBtn}</div>`;
  }).join('');
}

function recomputeZoneFromConstraints(){
  const baseZone = buildHideRadiusZone();
  if(!baseZone){
    toast('Could not rebuild base zone');
    return false;
  }
  validZone = baseZone;
  drawHideRadiusVisuals();
  for(const q of constraints){
    if(q.type === '_setup' || q.type === '_veto' || q.type === '_randomize_card') continue;
    const def = QDEFS[q.type];
    if(!def) continue;
    validZone = def.applyToZone(validZone, q) || validZone;
  }
  renderZone();
  renderLog();
  saveGame();
  return true;
}

function deleteConstraintAt(index){
  if(index < 0 || index >= constraints.length) return;
  if(constraints[index]?.type === '_setup') return;
  constraints.splice(index, 1);
  if(recomputeZoneFromConstraints()){
    toast('Constraint removed and zone recomputed');
  }
}
