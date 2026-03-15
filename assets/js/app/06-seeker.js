// ══════════════════════════════════════════════════════
//  SEEKER: APPLY ANSWER
// ══════════════════════════════════════════════════════
function applyAnswer(){
  const raw = document.getElementById('json-in').value.trim();
  if(!raw){ toast('Paste an answered JSON first'); return; }
  applyAnswerFromRaw(raw, ()=>{ document.getElementById('json-in').value=''; switchTab('log'); });
}

function applyAnswerFromRaw(raw, onSuccess){
  let q; try{ q=JSON.parse(raw); }catch(e){ toast('Invalid JSON — check format'); return; }

  // Veto
  if(q.type === 'veto'){
    constraints.push({type:'_veto', _label:'Veto card played — question nullified'});
    renderLog(); saveGame(); onSuccess();
    showResult('🚫','Question Vetoed!',
      'The hider played their Veto card. This question is nullified — no zone change.',
      null, null);
    return;
  }

  // Randomize card — seekers must now build the specified question type and send to hider
  if(q.type === 'randomize_card'){
    const def = QDEFS[q.question_type];
    if(!def){ toast(`Unknown question type: "${q.question_type}"`); return; }
    constraints.push({type:'_randomize_card', _qtype: q.question_type, _label:`Randomize card — new question: ${def.label}`});
    renderLog(); saveGame(); onSuccess();
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
    if(!nz){ toast('Zone empty — contradiction?'); return; }
    validZone = nz; constraints.push(q);
    renderZone(); renderLog();
    saveGame();
    onSuccess(); toast('Zone updated ✓');
  }catch(e){ toast('Error: '+e.message); }
}

function showResult(emoji, title, sub, qboxHTML, autoSelectType=null){
  document.getElementById('ro-emoji').textContent = emoji;
  document.getElementById('ro-title').textContent = title;
  document.getElementById('ro-sub').textContent   = sub;

  // qbox (used for extra text)
  const qb = document.getElementById('ro-qbox');
  if(qboxHTML){ qb.innerHTML = qboxHTML; qb.style.display='block'; }
  else { qb.style.display='none'; }

  // Question type pill (randomize only)
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

  // CTA button
  document.getElementById('ro-cta-btn').textContent = autoSelectType ? 'Build This Question →' : 'Got it →';
  document.getElementById('result-overlay').classList.remove('hidden');
}

function closeResult(){
  document.getElementById('result-overlay').classList.add('hidden');
  if(_pendingRandomizeType){
    const t = _pendingRandomizeType; _pendingRandomizeType = null;
    switchTab('build');
    selectQType(t);
  } else {
    switchTab('log');
  }
}

function renderLog(){
  const el = document.getElementById('log-list');
  if(!constraints.length){ el.innerHTML='<p class="empty">No constraints applied yet.</p>'; return; }
  el.innerHTML = constraints.map(q => {
    if(q.type==='_setup')
      return `<div class="citem"><span class="ctag" style="background:rgba(240,160,48,0.2);color:var(--gold)">SETUP</span><div class="cdesc"><b>${q._label}</b></div></div>`;
    if(q.type==='_veto')
      return `<div class="citem"><span class="ctag" style="background:rgba(232,64,64,0.15);color:var(--accent)">VETO</span><div class="cdesc"><b>Question vetoed — no info gained</b></div></div>`;
    if(q.type==='_randomize_card'){
      const def=QDEFS[q._qtype];
      return `<div class="citem"><span class="ctag" style="background:rgba(160,96,255,0.2);color:var(--purple)">RANDOM</span><div class="cdesc"><b>Randomize card played</b> — new question type: <b>${def?def.label:q._qtype}</b></div></div>`;
    }
    const def=QDEFS[q.type];
    return `<div class="citem"><span class="ctag ${def?def.colorTag:'tag-radar'}">${def?def.label:q.type}</span><div class="cdesc">${def?def.describe(q):JSON.stringify(q)}</div></div>`;
  }).join('');
}
