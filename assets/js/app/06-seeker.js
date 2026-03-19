//  SEEKER: APPLY ANSWER
// ========================================================
function resolveAnsweredQuestion(payload){
  if(payload.type === 'veto' || payload.type === 'randomize_card') return payload;
  if(!payload?.answer){ return null; }
  if(payload.type){
    const def = QDEFS[payload.type];
    const extraKeys = Object.keys(payload).filter(k => !['id','type','answer'].includes(k));
    if(def && extraKeys.length) return payload;
  }
  if(!payload.id) return null;
  const base = (currentBuiltQuestion && currentBuiltQuestion.id === payload.id)
    ? cloneForStorage(currentBuiltQuestion)
    : getOutgoingQuestion(payload.id);
  if(!base) return null;
  return {...base, answer: payload.answer};
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
    const def = QDEFS[q.question_type];
    if(!def){ toast(`Unknown question type: "${q.question_type}"`); return; }
    constraints.push({type:'_randomize_card', _qtype: q.question_type, _label:`Randomize card - new question: ${def.label}`});
    renderLog();
    saveGame();
    onSuccess();
    _pendingRandomizeType = q.question_type;
    showResult(
      '🎲',
      'Randomize Card!',
      'The hider played their Randomize card. Build the question type shown below on the map and send it to the hider to answer.',
      null,
      q.question_type
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
  if(_pendingRandomizeType){
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
      return `<div class="citem"><span class="ctag" style="background:rgba(160,96,255,0.2);color:var(--purple)">RANDOM</span><div class="cdesc"><b>Randomize card played</b> - new question type: <b>${def ? def.label : q._qtype}</b></div>${delBtn}</div>`;
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
