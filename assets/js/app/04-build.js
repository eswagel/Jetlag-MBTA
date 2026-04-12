// Load after the helper scripts in assets/js/app/build/.
// This file keeps the preview/apply layer and shared build state.

const SIMUL_OPTS = {
  radar:    [{val:'yes',    icon:'✅', label:'Within',    color:'#18b050'}, {val:'no',      icon:'❌', label:'Outside',  color:'#e84040'}],
  thermo:   [{val:'closer', icon:'🔥', label:'Closer',    color:'#f0a030'}, {val:'further', icon:'❄️', label:'Further',  color:'#3a8eff'}],
  measure:  [{val:'closer', icon:'🔥', label:'Closer',    color:'#f0a030'}, {val:'further', icon:'❄️', label:'Further',  color:'#3a8eff'}],
  matching: [{val:'Yes', icon:'✅', label:'Yes — same', color:'#18b050'}, {val:'No', icon:'❌', label:'No — different', color:'#e84040'}],
  nearest:  [{val:'Yes', icon:'✅', label:'Yes — same', color:'#18b050'}, {val:'No', icon:'❌', label:'No — different', color:'#e84040'}],
  tentacles:[{val:'no',     icon:'❌', label:'Not nearby',color:'#e84040'}],
};

let _simulActive = null;
let _tentacleSelection = null;

function updatePreview(){
  previewLayer.clearLayers();
  if(!qtype) return;
  try{
    if(qtype==='radar'&&qparams.center&&qparams.radius_miles) previewLayer.addData(makeCircle(qparams.center,qparams.radius_miles,'miles'));
    if(qtype==='thermo'){
      syncThermoHandleMarker();
      if(qparams.center&&qparams.travel_miles) previewLayer.addData(makeCircle(qparams.center,qparams.travel_miles,'miles'));
      if(qparams.center&&qparams.thermo_dest){
        previewLayer.addData(turf.lineString([
          [qparams.center.lng, qparams.center.lat],
          [qparams.thermo_dest.lng, qparams.thermo_dest.lat],
        ]));
        previewLayer.addData(thermoDividerLine(qparams.center, qparams.thermo_dest));
      }
    }
    if(qtype==='measure'&&qparams.measure_mode!=='elevation'&&qparams.measure_seeker_nearest&&qparams.measure_seeker_dist) previewLayer.addData(makeCircle(qparams.measure_seeker_nearest,qparams.measure_seeker_dist,'miles'));
    if(qtype==='tentacles'&&qparams.center&&qparams.radius_miles) previewLayer.addData(makeCircle(qparams.center,qparams.radius_miles,'miles'));
    if(qtype==='custom_boundary'&&qparams.custom_boundary_geojson) previewLayer.addData(qparams.custom_boundary_geojson);
  }catch(e){}
  if(previewLayer?.bringToFront) previewLayer.bringToFront();
  if(thermoHandleMarker?.bringToFront) thermoHandleMarker.bringToFront();
  refreshActiveAnswerPreview();
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}

function getQuestionWithLocalContext(question){
  if(!question) return null;
  if(question.type === 'tentacles' && (!Array.isArray(question.options) || question.options.length < 2) && question.id){
    const local = (currentBuiltQuestion && currentBuiltQuestion.id === question.id)
      ? currentBuiltQuestion
      : getOutgoingQuestion(question.id);
    if(local?.type === 'tentacles' && Array.isArray(local.options) && local.options.length >= 2){
      return local;
    }
  }
  return question;
}

function getTentacleSelectionQuestion(question){
  const q = getQuestionWithLocalContext(question || getLivePreviewQuestion() || currentBuiltQuestion);
  return q?.type === 'tentacles' ? q : null;
}

function isTentacleSelectionActive(question){
  const q = getTentacleSelectionQuestion(question);
  return !!(q && _tentacleSelection && _tentacleSelection.questionId === q.id);
}

function tentacleSelectionPrompt(mode){
  return mode === 'apply'
    ? 'Tap a tentacle pin on the map to apply locally, or cancel.'
    : 'Tap a tentacle pin on the map to preview, or cancel.';
}

function updateTentacleSelectionPanels(question){
  const q = getTentacleSelectionQuestion(question);
  if(!q) return;
  renderSimulBtns(q);
  renderDirectApplyBtns(q);
}

function startTentacleSelection(mode, question){
  const q = getTentacleSelectionQuestion(question);
  if(!q){ toast('Generate a tentacles question first'); return; }
  _tentacleSelection = {mode, questionId:q.id};
  updateTentacleSelectionPanels(q);
  renderTentacleRegionsPreview(q);
}

function cancelTentacleSelection(question){
  const q = getTentacleSelectionQuestion(question);
  _tentacleSelection = null;
  _simulActive = null;
  clearZonePreview();
  updatePreview();
  if(q) updateTentacleSelectionPanels(q);
}

function handleTentaclePinTap(option, index, question){
  const q = getTentacleSelectionQuestion(question);
  if(!isTentacleSelectionActive(q)) return;
  const pending = _tentacleSelection;
  const val = option.id || buildTentacleOptionId(option, index);
  _tentacleSelection = null;
  updateTentacleSelectionPanels(q);
  if(pending.mode === 'apply') applyBuiltAnswer(val);
  else previewAnswer(val);
}

function getLocalApplyOptions(json){
  const question = getQuestionWithLocalContext(json);
  if(!question) return [];
  if(question.type === 'measure') return measureAnswerOptions(question);
  if(question.type === 'tentacles'){
    const opts = [{val:'no', icon:'❌', label:'Not nearby', color:'#e84040'}];
    (question.options || []).forEach((opt, i) => {
      opts.push({
        val: opt.id || buildTentacleOptionId(opt, i),
        icon: String(i + 1),
        label: opt.name,
        color: '#20c8b0',
      });
    });
    return opts;
  }
  if(SIMUL_OPTS[question.type]) return SIMUL_OPTS[question.type];
  if(question.type === 'photo'){
    return [{val:'sent', icon:'📸', label:'Photo sent', color:'#18b050'}];
  }
  return (question.answer_opts || []).map(val => ({
    val,
    icon:'•',
    label:String(val),
    color:'#20c8b0',
  }));
}

function renderDirectApplyBtns(json){
  const container = document.getElementById('direct-apply-btns');
  if(!container) return;
  const question = getQuestionWithLocalContext(json);
  if(question?.type === 'tentacles'){
    const active = isTentacleSelectionActive(question);
    container.innerHTML = active
      ? `<div class="simul-select-wrap tentacle-preview-tools">
           <div class="found-result" style="margin-bottom:8px">🐙 ${tentacleSelectionPrompt(_tentacleSelection.mode)}</div>
           <button class="simul-clear-btn" type="button" onclick="${_c(()=>cancelTentacleSelection(question))}">Cancel</button>
         </div>`
      : `<div class="simul-select-wrap tentacle-preview-tools">
           <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('apply', question))}">Apply Locally</button>
         </div>`;
    return;
  }
  const opts = getLocalApplyOptions(question);
  if(!opts.length){
    container.innerHTML = '';
    return;
  }
  container.innerHTML = opts.map(o =>
    `<button class="simul-btn" style="--simul-col:${o.color}" onclick="${_c(()=>applyBuiltAnswer(o.val))}">
      <span class="s-icon">${o.icon}</span>${o.label}
    </button>`
  ).join('');
}

function setPreviewMapMode(active){
  if(maskLayer?.setStyle){
    maskLayer.setStyle({
      color:'transparent',
      weight:0,
      fillColor:'#cc1010',
      fillOpacity: active ? 0.16 : 0.42,
    });
  }
  if(borderLayer?.setStyle){
    borderLayer.setStyle(active ? {
      color:'#7fd99b',
      weight:2,
      fillColor:'#7fd99b',
      fillOpacity:0.04,
      dashArray:'4 4',
    } : {
      color:'#18b050',
      weight:3,
      fillColor:'#18b050',
      fillOpacity:0.10,
      dashArray:'7 4',
    });
  }
}

function clearZonePreview(){
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  setPreviewMapMode(false);
}

function renderZonePreviewResult(result, label, color, shouldFit=true){
  if(!result) return;
  const hint = document.getElementById('simul-hint');
  const previewQuestion = getLivePreviewQuestion() || currentBuiltQuestion;
  const eliminated = safeDiff(validZone, result);
  setPreviewMapMode(true);
  simulLayer.clearLayers();
  simulMaskLayer.clearLayers();
  simulLayer.options.style = {
    color: '#4fe07c', weight: 3, fillColor: '#37c96b', fillOpacity: 0.30, interactive: false
  };
  simulMaskLayer.options.style = {
    color: '#ff6b6b', weight: 2, fillColor: '#ff5a5a', fillOpacity: 0.30, interactive: false
  };
  simulLayer.addData(result);
  if(eliminated) simulMaskLayer.addData(eliminated);
  if(shouldFit){
    try{ map.fitBounds(L.geoJSON(result).getBounds().pad(0.12)); }catch(e){}
  }
  const area = (turf.area(result)/1e6).toFixed(1);
  const pctRemain = validZone ? Math.round(turf.area(result)/turf.area(validZone)*100) : '?';
  const pctElim = typeof pctRemain === 'number' ? 100 - pctRemain : '?';
  if(hint){
    hint.innerHTML = `<b>${label}:</b> ${area} km² remain <span style="color:${color}">(${pctElim}% eliminated)</span><br><span style="font-size:8px;color:var(--dim)">Green stays in play. Red is eliminated by this answer.</span>`;
    hint.className = 'simul-result-hint visible';
  }
  const msb = document.getElementById('msb-area');
  if(msb) msb.innerHTML = `<b style="color:var(--green)">${pctRemain}%</b> stays · <b style="color:#e84040">${pctElim}%</b> cut`;
  if(previewQuestion?.type === 'tentacles') document.getElementById('map-simul-bar').classList.remove('visible');
  else document.getElementById('map-simul-bar').classList.add('visible');
}

function getLivePreviewQuestion(){
  const activeType = getActiveBuildQType();
  if(currentBuiltQuestion && currentBuiltQuestion.type === activeType) return currentBuiltQuestion;
  if(!qtype || !QDEFS[activeType] || !QDEFS[activeType].isReady(qparams)) return null;
  try{
    return {
      ...QDEFS[activeType].toJSON(qparams),
      _constraint_union: activeType === 'measure' ? qparams.measure_constraint_union || null : null,
    };
  }catch(e){
    return null;
  }
}

function renderTentacleRegionsPreview(question){
  const q = getQuestionWithLocalContext(question) || getQuestionWithLocalContext(getLivePreviewQuestion()) || currentBuiltQuestion;
  if(!q || q.type !== 'tentacles'){
    toast('Generate a tentacles question first');
    return;
  }
  const options = getTentacleDisplayOptions(q);
  const colorById = getTentaclePreviewColorMap(options);
  const {circle, regions} = buildTentacleRegions(q, validZone);
  if(!circle){
    toast('Could not build tentacles preview');
    return;
  }
  clearZonePreview();
  if(tentaclePreviewLayer) tentaclePreviewLayer.clearLayers();
  tentaclePreviewLayer.addData({
    type:'Feature',
    properties:{
      color:'#20c8b0',
      strokeColor:'#20c8b0',
      fillColor:'#20c8b0',
      fillOpacity:0.04,
      weight:2,
      dashArray:'6 4',
      opacity:0.9,
    },
    geometry: circle.geometry,
  });
  tentaclePreviewLayer.addData({
    type:'FeatureCollection',
    features: regions.map((item, i) => {
      const key = String(item?.option?.id || '').trim() || String(item?.index ?? i);
      const col = colorById.get(key) || getTentaclePreviewColor(item?.index ?? i);
      return {
        ...cloneGeo(item.region),
        properties:{
          color: col,
          strokeColor: col,
          fillColor: col,
          fillOpacity:0.18,
          weight:2,
          opacity:0.95,
        },
      };
    }),
  });
  setPreviewMapMode(true);
  const hint = document.getElementById('simul-hint');
  if(hint){
    hint.innerHTML = `<b>Preview Regions:</b> inside the ${q.radius_miles || 1} mile circle, each colored region matches the nearest tentacle pin.<br><span style="font-size:8px;color:var(--dim)">Tap a pin on the map to preview or apply, or cancel to return.</span>`;
    hint.className = 'simul-result-hint visible';
  }
  const msb = document.getElementById('msb-area');
  if(msb) msb.innerHTML = 'tap a tentacle pin on the map';
  document.getElementById('map-simul-bar').classList.remove('visible');
}

function previewTentacleRegions(){
  startTentacleSelection('preview', getLivePreviewQuestion() || currentBuiltQuestion);
}

function refreshActiveAnswerPreview(){
  if(!_simulActive || !qtype) return;
  const liveQ = getQuestionWithLocalContext(getLivePreviewQuestion());
  const def = liveQ ? QDEFS[liveQ.type] : QDEFS[getActiveBuildQType()];
  const opts = getLocalApplyOptions(liveQ);
  if(!def || !opts) return;
  const opt = opts.find(o=>o.val===_simulActive);
  if(!opt) return;
  if(!liveQ) return;
  try{
    ensureMeasureConstraint(liveQ);
    const q = {...liveQ, answer:_simulActive, answer_label: opt.label};
    const result = def.applyToZone(validZone, q);
    if(!result) return;
    renderZonePreviewResult(result, `${opt.icon} ${opt.label}`, opt.color, false);
  }catch(e){}
}

function escapePreviewOptionLabel(text){
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSimulBtns(json){
  const question = getQuestionWithLocalContext(json);
  const opts = getLocalApplyOptions(question);
  const container = document.getElementById('simul-btns');
  const hint      = document.getElementById('simul-hint');
  const bar       = document.getElementById('map-simul-bar');
  const msbBtns   = document.getElementById('msb-btns');
  const msbArea   = document.getElementById('msb-area');
  const preserved = question?.type === 'tentacles'
    ? null
    : (opts.some(o=>o.val===_simulActive) ? _simulActive : null);
  _simulActive = preserved;
  clearZonePreview();
  updatePreview();
  if(hint){
    hint.className = 'simul-result-hint';
    hint.innerHTML = '';
  }
  if(!opts.length){
    container.innerHTML='';
    msbBtns.innerHTML='';
    bar.classList.remove('visible');
    if(msbArea) msbArea.innerHTML = 'green stays · red goes';
    return;
  }
  if(question?.type === 'tentacles'){
    const active = isTentacleSelectionActive(question);
    container.innerHTML = active
      ? `
      <div class="simul-select-wrap tentacle-preview-tools">
        <div class="found-result" style="margin-bottom:8px">🐙 ${tentacleSelectionPrompt(_tentacleSelection.mode)}</div>
        <button class="simul-clear-btn" type="button" onclick="${_c(()=>cancelTentacleSelection(question))}">Cancel</button>
      </div>
    `
      : `
      <div class="simul-select-wrap tentacle-preview-tools">
        <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('preview', question))}">Preview Regions</button>
        <button class="simul-clear-btn tentacle-preview-btn" type="button" onclick="${_c(()=>startTentacleSelection('apply', question))}">Apply Locally</button>
      </div>
    `;
    msbBtns.innerHTML = '';
    bar.classList.remove('visible');
    if(msbArea) msbArea.innerHTML = active ? tentacleSelectionPrompt(_tentacleSelection.mode) : 'choose Preview Regions or Apply Locally';
    return;
  }
  container.innerHTML = opts.map(o =>
    `<button class="simul-btn" id="sb-${o.val}"
       style="--simul-col:${o.color}"
       onclick="previewAnswer('${o.val}')">
       <span class="s-icon">${o.icon}</span>${o.label}
     </button>`
  ).join('');
  msbBtns.innerHTML = opts.map(o =>
    `<button class="msb-btn" id="msb-${o.val}"
       style="--msb-col:${o.color}"
       onclick="previewAnswer('${o.val}')">
       ${o.icon} ${o.label}
     </button>`
  ).join('');
  bar.classList.add('visible');
  if(_simulActive){
    const btn  = document.getElementById(`sb-${_simulActive}`);
    const mbtn = document.getElementById(`msb-${_simulActive}`);
    if(btn) btn.classList.add('active');
    if(mbtn) mbtn.classList.add('active');
    refreshActiveAnswerPreview();
  } else if(msbArea){
    msbArea.innerHTML = 'green stays · red goes';
  }
}

function previewAnswer(val){
  const baseQuestion = getQuestionWithLocalContext(getLivePreviewQuestion() || currentBuiltQuestion);
  const def = baseQuestion ? QDEFS[baseQuestion.type] : QDEFS[getActiveBuildQType()];
  const opts = getLocalApplyOptions(baseQuestion);
  const hint = document.getElementById('simul-hint');
  const msbArea = document.getElementById('msb-area');

  if(!val){
    _simulActive = null;
    clearZonePreview();
    updatePreview();
    document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
    if(baseQuestion?.type === 'tentacles') _tentacleSelection = null;
    if(hint){
      hint.className = 'simul-result-hint';
      hint.innerHTML = '';
    }
    if(msbArea) msbArea.innerHTML = baseQuestion?.type === 'tentacles'
      ? 'tap a tentacle pin on the map'
      : 'green stays · red goes';
    return;
  }

  if(_simulActive === val){
    _simulActive = null;
    clearZonePreview();
    updatePreview();
    document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
    if(baseQuestion?.type === 'tentacles') _tentacleSelection = null;
    if(hint){
      hint.className = 'simul-result-hint';
      hint.innerHTML = '';
    }
    if(msbArea) msbArea.innerHTML = baseQuestion?.type === 'tentacles'
      ? 'tap a tentacle pin on the map'
      : 'green stays · red goes';
    return;
  }

  _simulActive = val;
  document.querySelectorAll('.simul-btn,.msb-btn').forEach(b=>b.classList.remove('active'));
  const btn  = document.getElementById(`sb-${val}`);
  const mbtn = document.getElementById(`msb-${val}`);
  if(btn)  btn.classList.add('active');
  if(mbtn) mbtn.classList.add('active');

  const opt = opts.find(o=>o.val===val);
  const col = opt ? opt.color : '#20c8b0';

  try {
    const liveQ = getQuestionWithLocalContext(getLivePreviewQuestion());
    const baseQ = liveQ || getQuestionWithLocalContext(JSON.parse(document.getElementById('json-out').value));
    runSlowMeasureAction(baseQ, () => {
      try{
        ensureMeasureConstraint(baseQ);
        const q = opt ? {...baseQ, answer: val, answer_label: opt.label} : {...baseQ, answer: val};
        const result = def.applyToZone(validZone, q);
        if(!result){ toast('Nothing left in zone for this answer'); return; }
        renderZonePreviewResult(result, opt ? `${opt.icon} ${opt.label}` : val, col);
      }catch(e){
        toast('Preview error: '+e.message);
      }
    });
  } catch(e) {
    toast('Preview error: '+e.message);
  }
}

function applyBuiltAnswer(val){
  const raw = document.getElementById('json-out').value.trim();
  if(!raw){ toast('Generate a question first'); return; }
  try{
    const parsed = JSON.parse(raw);
    const base = currentBuiltQuestion && currentBuiltQuestion.id === parsed.id
      ? currentBuiltQuestion
      : getOutgoingQuestion(parsed.id);
    const opt = getLocalApplyOptions(base || parsed).find(o => o.val === val);
    const q = base
      ? {...base, answer: val, ...(opt ? {answer_label: opt.label} : {})}
      : {...parsed, answer: val, ...(opt ? {answer_label: opt.label} : {})};
    runSlowMeasureAction(q, () => {
      try{
        ensureMeasureConstraint(q);
        applyAnswerObject(q, ()=>{
          resetBuild();
          switchTab('log');
        });
      }catch(e){
        toast('Could not apply built answer');
      }
    });
  }catch(e){
    toast('Could not apply built answer');
  }
}

function previewCustomBoundary(mode){
  const poly = qparams.custom_boundary_geojson || buildCustomBoundaryFeature(qparams.custom_boundary_points || []);
  if(!poly){ toast('Draw at least 3 points first'); return; }
  qparams.custom_boundary_geojson = poly;
  qparams.custom_boundary_mode = mode;
  qparams._drawingBoundary = false;
  hideBanner();
  const q = {type:'custom_boundary', boundary_geojson: poly, mode};
  const result = QDEFS.custom_boundary.applyToZone(validZone, q);
  if(!result){ toast('Nothing left in zone for this boundary'); return; }
  renderZonePreviewResult(result, mode === 'include' ? '✅ Include' : '❌ Exclude', mode === 'include' ? '#18b050' : '#e84040');
}

function applyCustomBoundary(){
  const poly = qparams.custom_boundary_geojson || buildCustomBoundaryFeature(qparams.custom_boundary_points || []);
  if(!poly){ toast('Draw at least 3 points first'); return; }
  if(!qparams.custom_boundary_mode){ toast('Choose include or exclude first'); return; }
  qparams._drawingBoundary = false;
  hideBanner();
  const q = {
    type:'custom_boundary',
    boundary_geojson: poly,
    mode: qparams.custom_boundary_mode,
  };
  const nz = QDEFS.custom_boundary.applyToZone(validZone, q);
  if(!nz){ toast('Zone empty — contradiction?'); return; }
  validZone = nz;
  constraints.push(q);
  renderZone();
  renderLog();
  saveGame();
  toast(`Custom boundary ${q.mode === 'include' ? 'included' : 'excluded'} ✓`);
  clearCustomBoundary();
  switchTab('log');
}

function copyQ(){
  navigator.clipboard.writeText(document.getElementById('json-out').value).then(()=>{
    const fl=document.getElementById('cf');
    fl.classList.add('on');
    setTimeout(()=>fl.classList.remove('on'),2200);
    toast('Copied! Send to your friend.');
  }).catch(()=>toast('Tap the text area and copy manually'));
}

function resetBuild(){
  qtype=null;
  qparams={};
  pickStep=-1;
  pickStepDefs=[];
  currentBuiltQuestion = null;
  _tentacleSelection = null;
  clearMarkers();
  previewLayer.clearLayers();
  clearZonePreview();
  hideBanner();
  clearBoundaryHighlight();
  _simulActive=null;
  document.querySelectorAll('.qbtn').forEach(b=>b.classList.remove('on'));
  document.getElementById('json-out-section').style.display='none';
  document.getElementById('map-simul-bar').classList.remove('visible');
  if(typeof setLoadQuestionPanelOpen === 'function') setLoadQuestionPanelOpen(false);
  const direct = document.getElementById('direct-apply-btns');
  if(direct) direct.innerHTML = '';
  renderBuildBody();
  if(typeof scheduleSaveGame === 'function') scheduleSaveGame();
}
