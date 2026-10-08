//  SEEKER: APPLY ANSWER
// ========================================================
let _pendingResultAction = null;

function isLatLngLike(value){
  const valid = n => n != null && n !== '' && Number.isFinite(Number(n));
  return valid(value?.lat) && valid(value?.lng) && Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lng)) <= 180;
}

function validateQuestionInputs(question){
  const contract=QUESTION_CONTRACTS[question?.type];
  if(!contract)return;
  const q=contractQuestion(question,contract);
  for(const [field,rule] of Object.entries(contract.inputs||{})){
    if(rule==='point'&&!isLatLngLike(q[field]))throw new Error('Question needs valid latitude and longitude');
    if(rule==='positive'&&(q[field]==null||q[field]===''||!Number.isFinite(Number(q[field]))||Number(q[field])<=0)){
      throw new Error(field==='radius_miles'?'Question radius must be a positive number':'Thermometer needs a valid destination and positive travel distance');
    }
  }
  const answers=typeof contract.answers==='function'?contract.answers(q):contract.answers;
  if(q.answer!=null&&answers&&!answers.includes(q.answer))throw new Error('Question has an invalid answer');
}

function normalizeLatLng(value){
  if(!isLatLngLike(value)) return null;
  return {lat:Number(value.lat), lng:Number(value.lng)};
}

function normalizeMatchingBoundaryForCenter(boundary, center){
  if(!boundary || !center || isChicagoGame()) return boundary || null;
  try{
    const pt = turf.point([center.lng, center.lat]);
    let normalized = boundary;
    if(!turf.booleanPointInPolygon(pt, normalized)){
      const bbox = cloneGeo(INIT_POLY);
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
    const categoryLabel = String(payload.category_id || payload.category || payload.category_label || '').trim();
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
  const category = resolveCategory('matching',payload)?.id || payload.category || payload.category_label;
  const categoryLabel = payload.category_label || category;
  if(!center || !category) throw new Error('Matching question is missing center or category');
  if(category === 'line' && !payload.boundary_geojson) return null;
  if(!payload.seeker_val && !('boundary_geojson' in payload)) return null;
  const boundary = category === 'line'
    ? (payload.boundary_geojson || null)
    : normalizeMatchingBoundaryForCenter(payload.boundary_geojson || null, center);
  const question = {
    id:payload.id,
    ...QDEFS.matching.toJSON({
      center,
      matching_cat:category,
      matching_cat_label:categoryLabel,
      matching_seeker_val:payload.seeker_val || 'Unknown',
      matching_line_id:payload.line_id || null,
      matching_service_snapshot:payload.service_snapshot || null,
      matching_hide_radius_miles:Number(payload.hide_radius_miles || hideRadiusMi),
      matching_boundary:boundary,
      _matching_boundary_simplified:boundary,
    }),
  };
  return typeof decorateConstraintQuestion === 'function'
    ? decorateConstraintQuestion(question)
    : question;
}

async function rebuildMatchingQuestion(payload){
  buildStoredQuestionBase(payload, 'matching');
  const center = normalizeLatLng(payload.center);
  const category = resolveCategory('matching',payload)?.id || payload.category || payload.category_label;
  const catObj = resolveCategory('matching',category);
  if(!center || !catObj) throw new Error('Unknown matching category');
  if(category === 'line' && !payload.line_id) throw new Error('Line matching question is missing line id');
  const result = await catObj.resolve(center, {
    lineId: payload.line_id || null,
    serviceSnapshot: payload.service_snapshot || null,
    hideRadiusMiles: Number(payload.hide_radius_miles || hideRadiusMi),
  });
  if(!result?.val) throw new Error(`Could not resolve ${payload.category_label || catObj.label}`);
  const boundary = category === 'line'
    ? (result.boundary || null)
    : normalizeMatchingBoundaryForCenter(result.boundary || null, center);
  const question = {
    id:payload.id,
    ...QDEFS.matching.toJSON({
      center,
      matching_cat:catObj.cat,
      matching_cat_label:payload.category_label || catObj.label,
      matching_seeker_val:result.val,
      matching_line_id:payload.line_id || result.line_id || null,
      matching_service_snapshot:payload.service_snapshot || result.service_snapshot || null,
      matching_hide_radius_miles:Number(payload.hide_radius_miles || hideRadiusMi),
      matching_boundary:boundary,
      _matching_boundary_simplified:boundary,
    }),
  };
  return typeof decorateConstraintQuestion === 'function'
    ? decorateConstraintQuestion(question)
    : question;
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
          return point ? {...placeIdentity(poi),name:String(poi?.name || categoryLabel || 'POI'), ...point} : null;
        })
        .filter(Boolean)
    : [];
  if(!center || !categoryLabel || !seekerPoiPoint) return null;
  return {
    id:payload.id,
    ...QDEFS.nearest.toJSON({
      center,
      nearest_cat:payload.category_id || payload.category || categoryLabel,
      nearest_cat_label:categoryLabel,
      nearest_seeker_poi:{...placeIdentity(payload.seeker_poi),name:String(payload.seeker_poi?.name || categoryLabel), ...seekerPoiPoint},
      nearest_all_pois:allPois,
      nearest_voronoi:payload.voronoi_geojson || null,
    }),
  };
}

async function rebuildNearestQuestion(payload){
  buildStoredQuestionBase(payload, 'nearest');
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const catObj = resolveCategory('nearest',payload.category_id || payload.category || categoryLabel);
  if(!center || !catObj) throw new Error('Unknown nearest category');
  const pois = await getCategoryInstances(catObj, center, 35000);
  if(!pois.length) throw new Error(`No ${categoryLabel} found nearby`);
  pois.sort((a,b)=>turfDist(center,a)-turfDist(center,b));
  const nearest = pois[0];
  let voronoi = null;
  if(pois.length >= 2){
    try{
      const fc = turf.featureCollection(pois.map(p=>turf.point([p.lng,p.lat])));
      const cells = turf.voronoi(fc, {bbox:[W,S,E,N]});
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
      nearest_cat:catObj.id,
      nearest_cat_label:payload.category_label || catObj.label,
      nearest_seeker_poi:nearest,
      nearest_all_pois:pois.slice(0,20),
      nearest_voronoi:voronoi,
    }),
  };
}

function buildStoredMeasureQuestion(payload){
  buildStoredQuestionBase(payload, 'measure');
  // Original border questions stored nearest-vertex distances. Rebuild imported
  // questions from the current boundary segments rather than trusting that context.
  if(categorySpec('measure',payload)?.boundaryKey) return null;
  const center = normalizeLatLng(payload.center);
  const categoryLabel = payload.category_label || payload.category;
  const mode = payload.mode || (isSeaLevelMeasure(payload) ? 'elevation' : 'distance');
  if(!center || !categoryLabel) throw new Error('Measure question is missing center or category');
  if(mode === 'elevation'){
    const seekerFeet = payload.seeker_elevation_ft;
    if(!validElevationNumber(seekerFeet)) return null;
    return {
      id:payload.id,
      ...QDEFS.measure.toJSON({
        center,
        measure_mode:'elevation',
        measure_cat:payload.category_id || payload.category || categoryLabel,
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
      measure_cat:payload.category_id || payload.category || categoryLabel,
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
  if(!center) throw new Error('Unknown measure center');
  const result = await resolveMeasurement(payload, center);
  return {id:payload.id,...QDEFS.measure.toJSON(measurementBuildParams(result))};
}

async function hydrateOutgoingQuestionContent(payload){
  if(!payload || typeof payload !== 'object') throw new Error('JSON must be an object');
  if(payload.answer) throw new Error('Paste the original question JSON, not the answer');
  validateQuestionInputs(payload);
  if(payload.type === 'veto' || payload.type === 'randomize_card') throw new Error('Card results are not loadable questions');
  if(!payload.type) throw new Error('Question is missing a type');

  const contract = QUESTION_CONTRACTS[payload.type];
  if(!contract) throw new Error(`Unsupported question type: ${payload.type}`);
  return await contract.hydrate(contractQuestion(payload, contract));
}

async function hydrateOutgoingQuestion(payload){
  const error = cityCompatibilityError(payload);
  if(error) throw new Error(error);
  await ensureQuestionDataReady(payload);
  validateQuestionForCity(payload);
  return normalizeConstraintEntry(stampCityPayload(await hydrateOutgoingQuestionContent(payload)));
}

let seekerLoadRevision = 0;
async function loadQuestionFromRaw(raw, onSuccess){
  let payload;
  try{
    payload = JSON.parse(raw);
  }catch(e){
    toast('Invalid JSON - check format');
    return;
  }

  const revision = ++seekerLoadRevision;
  const buildIsCurrent = beginBuildLookup();
  const isCurrent = () => revision === seekerLoadRevision && buildIsCurrent();
  try{
    toast('Loading question context...', 3200);
    const question = await hydrateOutgoingQuestion(payload);
    if(!isCurrent()) return;
    rememberOutgoingQuestion(question);
    saveGame();
    onSuccess(question);
  }catch(e){
    if(!isCurrent()) return;
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
  return contractBuildParams(question);
}

function presetToBuildParams(preset){
  const type=preset?.build_qtype==='matching'&&preset.mode==='nearest'?'nearest':preset?.build_qtype;
  return contractBuildParams({...preset,type},{preset:true});
}

function syncLoadedQuestionHighlights(question){
  if(question.type === 'matching'){
    highlightBoundary(question.category);
    return;
  }
  if(question.type === 'measure'){
    const boundaryKey=resolveCategory('measure',question)?.boundaryKey;
    if(boundaryKey) highlightBoundary(boundaryKey);
    else clearBoundaryHighlight();
    return;
  }
  clearBoundaryHighlight();
}

function setLoadQuestionPanelOpen(open){
  if(!open) ++seekerLoadRevision;
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
  if(typeof _tentacleSelection !== 'undefined') _tentacleSelection = null;

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
  if(question.type === 'tentacles' && typeof renderTentacleOptionPins === 'function'){
    renderTentacleOptionPins(currentBuiltQuestion);
  }
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
      const boundaryKey=resolveCategory('measure',qparams.measure_cat || qparams.measure_cat_label)?.boundaryKey;
      if(boundaryKey) highlightBoundary(boundaryKey);
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
  if(currentBuiltQuestion?.type === 'tentacles' && typeof renderTentacleOptionPins === 'function'){
    renderTentacleOptionPins(currentBuiltQuestion);
  }
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
  if(typeof _tentacleSelection !== 'undefined') _tentacleSelection = null;
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
  if(!payload?.answer) return null;
  const base = payload.id && ((currentBuiltQuestion?.id === payload.id)
    ? cloneForStorage(currentBuiltQuestion) : getOutgoingQuestion(payload.id));
  if(base){
    if(payload.type && payload.type !== base.type) return null;
    return {...base, ...payload};
  }
  return QDEFS[payload.type] ? payload : null;
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
    if(!applyConstraintIncrementally(q)){
      return;
    }
    forgetOutgoingQuestion(q.id);
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

let answerLoadRevision = 0;
async function applyAnswerFromRaw(raw, onSuccess){
  let payload;
  try{ payload = JSON.parse(raw); }
  catch(e){ toast('Invalid JSON - check format'); return; }
  const compatibilityError = cityCompatibilityError(payload);
  if(compatibilityError){ toast(compatibilityError); return; }
  const candidate = resolveAnsweredQuestion(payload);
  if(!candidate){
    toast('Original question data not found on this device or answer is missing');
    return;
  }
  const revision = ++answerLoadRevision;
  const previousConstraints = constraints.slice(), previousRadius = hideRadiusMi;
  const isCurrent = () => revision === answerLoadRevision && hideRadiusMi === previousRadius &&
    constraints.length === previousConstraints.length && constraints.every((q,i)=>q===previousConstraints[i]);
  try{
    let question = candidate;
    if(QUESTION_CONTRACTS[candidate.type]){
      // Every answer entry point needs the same canonical context as an imported
      // question. Compact packets cannot be applied as geometry-free clues.
      const original = {...candidate};
      delete original.answer;
      question = {...await hydrateOutgoingQuestion(original),answer:candidate.answer};
      if(candidate.answer_label != null)question.answer_label=candidate.answer_label;
    }
    if(!isCurrent())return;
    validateQuestionForCity(question);
    validateQuestionInputs(question);
    const def=QDEFS[question.type];
    if(def?.hasSpatialContext && getQuestionConstraintScope(question)==='location' && !def.hasSpatialContext(question)){
      throw new Error('Question geography could not be reconstructed');
    }
    applyAnswerObject(question, onSuccess);
  }catch(e){ if(isCurrent())toast(`Could not apply answer: ${e.message}`); }
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
    const effectTag = getQuestionConstraintScope(q) === 'location'
      ? `<span class="ctag" style="background:rgba(240,160,48,0.2);color:var(--gold)">LOCATION</span>`
      : '';
    return `<div class="citem">${effectTag}<span class="ctag ${def ? def.colorTag : 'tag-radar'}">${def ? def.label : q.type}</span><div class="cdesc">${def ? def.describe(q) : JSON.stringify(q)}</div>${delBtn}</div>`;
  }).join('');
}

function exportQuestionLog(){
  const payload = {
    kind:'jetlag_question_log',
    version:4,
    ...cityMetadata(),
    hide_radius_miles:hideRadiusMi,
    exported_at:new Date().toISOString(),
    constraints: cloneForStorage(constraints),
  };
  const text = JSON.stringify(payload);
  const input = document.getElementById('log-transfer-json');
  if(input) input.value = text;
  navigator.clipboard.writeText(text)
    .then(()=>toast('Question log exported and copied'))
    .catch(()=>toast('Question log exported (copy manually)'));
}

function importedLogRadius(parsed, entries){
  let radius = parsed?.hide_radius_miles;
  if(radius == null){
    const setup = entries.find(q=>q.type === '_setup');
    radius = setup?.hide_radius_miles;
    // Versions 1–3 stored the radius only in the setup description.
    if(radius == null && setup?._label){
      const match = /^Hide radius: ([\d.]+) (ft|mi) from any station$/.exec(setup._label);
      if(!match) throw new Error('Cannot read the hiding radius in this older log. Export it again from its original game.');
      radius = Number(match[1]) / (match[2] === 'ft' ? 5280 : 1);
    }
  }
  if(radius == null) radius = hideRadiusMi; // Legacy logs without setup retain the current radius.
  if(typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > 100){
    throw new Error('Question log has an invalid hiding radius');
  }
  return radius;
}

async function prepareQuestionLog(parsed){
  const compatibilityError = cityCompatibilityError(parsed);
  if(compatibilityError) throw new Error(compatibilityError);
  if(parsed?.version > 4) throw new Error('Question log uses a newer format');
  const entries = Array.isArray(parsed) ? parsed : parsed?.constraints;
  if(!Array.isArray(entries) || !entries.every(q=>q && typeof q === 'object' && typeof q.type === 'string')){
    throw new Error('Question log entries are malformed');
  }
  const radius = importedLogRadius(parsed, entries);
  const hydrated = [];
  for(const entry of entries){
    if(entry.city_id || entry.dataset_version){
      const error = cityCompatibilityError(entry);
      if(error) throw new Error(error);
    }
    if(['_setup','_veto','_randomize_card'].includes(entry.type)){
      hydrated.push(entry.type === '_setup' ? {...cloneForStorage(entry), hide_radius_miles:radius,
        _label:`Hide radius: ${radius < 1 ? (radius*5280).toFixed(0)+' ft' : radius+' mi'} from any station`} : cloneForStorage(entry));
      continue;
    }
    if(!QDEFS[entry.type]) throw new Error(`Unknown question type: ${entry.type}`);
    if(entry.type === 'custom_boundary'){
      if(!['include','exclude'].includes(entry.mode) || !entry.boundary_geojson || !Number.isFinite(turf.area(entry.boundary_geojson))){
        throw new Error('Question log contains an invalid custom boundary');
      }
      hydrated.push(cloneForStorage(entry));
      continue;
    }
    if(entry.answer == null) throw new Error('Question log contains an unanswered question');
    validateQuestionInputs(entry);
    const original = {...cityMetadata(), ...entry};
    delete original.answer;
    // Hydration loads and checks referenced local datasets before any game mutation.
    const question = await hydrateOutgoingQuestion(original);
    hydrated.push({...question, answer:entry.answer,
      ...(entry._label ? {_label:entry._label} : {})});
  }
  const nextConstraints = normalizeConstraintList(hydrated);
  const previousRadius = hideRadiusMi;
  let state;
  try{
    hideRadiusMi = radius;
    const base = buildHideRadiusZone();
    if(!base) throw new Error('Could not rebuild the imported hiding area');
    state = deriveZoneStateFromConstraints(base, nextConstraints);
    if(!state?.validZone) throw new Error('Could not rebuild the imported zone');
  }finally{
    hideRadiusMi = previousRadius;
  }
  return {constraints:nextConstraints, radius, zone:state.validZone};
}

async function importQuestionLog(){
  const raw = (document.getElementById('log-transfer-json')?.value || '').trim();
  if(!raw){ toast('Paste an exported question log first'); return; }
  let parsed;
  try{ parsed=JSON.parse(raw); }catch(e){ toast('Invalid JSON - check format'); return; }
  let prepared;
  try{ prepared=await prepareQuestionLog(parsed); }
  catch(e){ toast(`Could not import log: ${e.message}`); return; }
  if(!window.confirm('Importing this question log will replace your current questions, answers, and hiding radius. Continue?')) return;
  hideRadiusMi = prepared.radius;
  commitZoneState(prepared.zone, prepared.constraints);
  switchTab('log');
  toast('Question log imported - previous log replaced');
}

function recomputeZoneFromConstraints(){
  const baseZone = buildHideRadiusZone();
  if(!baseZone){
    toast('Could not rebuild base zone');
    return false;
  }
  constraints = normalizeConstraintList(constraints);
  const nextState = deriveZoneStateFromConstraints(baseZone, constraints);
  if(!nextState?.validZone){
    toast('Could not rebuild zone state');
    return false;
  }
  stopRegionState = nextState.stopState || deriveStopRegionState(nextState.validZone, constraints);
  validZone = stopRegionState?.hardUnion || nextState.validZone;
  softZone = stopRegionState?.yellowUnion || nextState.softZone || null;
  drawHideRadiusVisuals();
  renderZone();
  renderLog();
  saveGame();
  return true;
}

function commitZoneState(nextHardZone, nextConstraints, preparedState=null){
  constraints = normalizeConstraintList(nextConstraints);
  const next = preparedState || deriveZoneStateFromConstraints(buildHideRadiusZone(), constraints);
  stopRegionState = next.stopState;
  validZone = next.validZone;
  softZone = stopRegionState?.yellowUnion || null;
  drawHideRadiusVisuals();
  renderZone();
  renderLog();
  saveGame();
  return true;
}

function applyConstraintIncrementally(question){
  const q = normalizeConstraintEntry(question);
  const def = QDEFS[q?.type];
  if(!def) return false;
  const nextConstraints = [...constraints, q];
  if(def.affectsZone === false){
    constraints = nextConstraints;
    clearZonePreview();
    renderLog();
    saveGame();
    return true;
  }
  const next = deriveZoneStateFromConstraints(buildHideRadiusZone(), nextConstraints);
  return commitZoneState(next.validZone, nextConstraints, next);
}

function deleteConstraintAt(index){
  if(index < 0 || index >= constraints.length) return;
  if(constraints[index]?.type === '_setup') return;
  const affectsZone = QDEFS[constraints[index]?.type]?.affectsZone !== false;
  constraints.splice(index, 1);
  if(!affectsZone){
    clearZonePreview();
    renderLog();
    saveGame();
    toast('Constraint removed');
    return;
  }
  if(recomputeZoneFromConstraints()){
    toast('Constraint removed and zone recomputed');
  }
}
