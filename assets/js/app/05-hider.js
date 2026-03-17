// ══════════════════════════════════════════════════════
//  HIDER ANSWER FLOW
// ══════════════════════════════════════════════════════
let _hiderQ = null;       // parsed question JSON currently being answered
let _pendingCard = null;  // 'veto' | 'randomize'
let _pendingRandomizeType = null; // set when seekers receive a randomize_card

// Answer options per question type (hider modal)
const ANS_OPTS = {
  radar:    [{val:'yes',    label:'Yes — within range', icon:'✅', cls:'yes'}, {val:'no',      label:'No — outside',  icon:'❌', cls:'no'}],
  thermo:   [{val:'closer', label:'Closer 🔥',          icon:'🔥', cls:'opt'}, {val:'further', label:'Further ❄️',   icon:'❄️', cls:'no'}],
  measure:  [{val:'closer', label:'Closer 🔥',          icon:'🔥', cls:'opt'}, {val:'further', label:'Further ❄️',   icon:'❄️', cls:'no'}],
  matching: [{val:'Yes', label:'Yes — same place', icon:'✅', cls:'yes'}, {val:'No', label:'No — different', icon:'❌', cls:'no'}],
  nearest:  [{val:'Yes', label:'Yes — same one',   icon:'✅', cls:'yes'}, {val:'No', label:'No — different', icon:'❌', cls:'no'}],
  photo:    [{val:'sent',   label:'Photo sent! 📸',      icon:'📸', cls:'yes'}],
  // tentacles: built dynamically in openAnswerModal
};

function hiderLoadQuestion(){
  const raw = document.getElementById('hider-json-in').value.trim();
  if(!raw){ toast('Paste a question JSON first'); return; }
  let q; try{ q=JSON.parse(raw); }catch(e){ toast('Invalid JSON'); return; }
  const def = QDEFS[q.type];
  if(!def){ toast(`Unknown question type: "${q.type}"`); return; }
  _hiderQ = q;

  // Show the locate state
  document.getElementById('hider-input-state').style.display  = 'none';
  document.getElementById('hider-locate-state').style.display = 'block';
  document.getElementById('hider-result-state').style.display = 'none';

  // Summary card
  document.getElementById('hider-q-summary').innerHTML =
    `<span style="font-size:11px;margin-right:6px">${QICONS[q.type]||'❓'}</span><b style="color:var(--text)">${def.label}</b><br>${describeQuestion(q, def)}`;

  const isGeo = ['radar','thermo','measure','tentacles'].includes(q.type);

  document.getElementById('hider-loc-section').style.display    = isGeo ? 'block' : 'none';
  document.getElementById('hider-manual-section').style.display = isGeo ? 'none'  : 'block';
  document.getElementById('hider-loc-set').style.display = 'none';

  if(!isGeo){
    if(q.type === 'matching'){
      document.getElementById('hider-manual-btns').innerHTML = `
        <p style="font-size:9px;color:var(--dim);margin-bottom:10px;font-family:'IBM Plex Mono',monospace">
          Are you in the same <b>${q.category_label}</b> as the seeker (${q.seeker_val})?
          Use your GPS to auto-answer, or answer manually.
        </p>
        <button class="btn btn-red" style="margin-bottom:8px" onclick="hiderAutoMatchLookup()">📡 Auto-answer with GPS</button>
        <div style="display:flex;gap:8px">
          <button class="ans-btn yes" style="flex:1" onclick="_amDispatch('Yes')"><span class="ans-ico">✅</span>Yes — same</button>
          <button class="ans-btn no"  style="flex:1" onclick="_amDispatch('No')"><span class="ans-ico">❌</span>No — different</button>
        </div>`;
    } else if(q.type === 'nearest'){
      document.getElementById('hider-manual-btns').innerHTML = `
        <p style="font-size:9px;color:var(--dim);margin-bottom:10px;font-family:'IBM Plex Mono',monospace">
          Is the nearest <b>${q.category_label}</b> to you also <b>${q.seeker_poi?.name}</b>?
          Use your GPS to auto-answer, or answer manually.
        </p>
        <button class="btn btn-red" style="margin-bottom:8px" onclick="hiderAutoNearestLookup()">📡 Auto-answer with GPS</button>
        <div style="display:flex;gap:8px">
          <button class="ans-btn yes" style="flex:1" onclick="_amDispatch('Yes')"><span class="ans-ico">✅</span>Yes — same</button>
          <button class="ans-btn no"  style="flex:1" onclick="_amDispatch('No')"><span class="ans-ico">❌</span>No — different</button>
        </div>`;
    } else {
      const opts = ANS_OPTS[q.type] || [{val:'yes',label:'Yes',icon:'✅',cls:'yes'},{val:'no',label:'No',icon:'❌',cls:'no'}];
      document.getElementById('hider-manual-btns').innerHTML = opts.map(o=>{
        const v=o.val;
        return `<button class="ans-btn ${o.cls}" onclick="_amDispatch(${JSON.stringify(v)})">
          <span class="ans-ico">${o.icon}</span><span>${o.label}</span></button>`;
      }).join('');
    }
  }
}

// Geo types: GPS button
function setHiderStation(stop){
  _pickingHiderStation = false;
  hideBanner();

  hiderStation = stop;

  // Place a distinctive hider pin on the station
  if(_hiderLocMarker) _hiderLocMarker.remove();
  _hiderLocMarker = L.marker([stop.lat, stop.lng], {icon:hiderPin(), zIndexOffset:3000}).addTo(map);
  map.setView([stop.lat, stop.lng], 14);

  // Update the hider tab station indicator
  renderHiderStationBadge();

  // Save the station
  saveGame();
  toast(`📍 Station set: ${stop.name}`);

  // Open panel to Answer tab
  document.getElementById('panel').classList.remove('collapsed');
  switchTab('hider');
}

function renderHiderStationBadge(){
  const el = document.getElementById('hider-station-badge');
  if(!el) return;
  if(!hiderStation){
    el.style.display = 'none';
    return;
  }
  const lines = hiderStation.lines || [];
  const dots = lines.map(lid=>{
    const gl = GAME_LINES.find(g=>g.id===lid);
    return gl ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${gl.color};margin-right:3px;vertical-align:middle"></span>` : '';
  }).join('');
  el.innerHTML = `<span style="font-size:9px;color:var(--purple)">🚇 Your station:</span> ${dots}<b style="font-size:10px">${hiderStation.name}</b>
    <span style="display:block;font-size:8px;color:var(--dim);margin-top:2px">Used for station identity questions. Geo questions will ask for your exact location.</span>
    <span style="font-size:8px;color:var(--dim);cursor:pointer;text-decoration:underline" onclick="promptHiderStationPick()">Change station</span>`;
  el.style.display = 'block';
}

async function hiderAutoMatchLookup(){
  const q = _hiderQ;
  if(!q || q.type !== 'matching') return;
  const cat = MATCHING_CATS.find(c=>c.cat === q.category);
  if(!cat){ toast('Unknown category'); return; }

  const btns = document.getElementById('hider-manual-btns');
  if(btns) btns.innerHTML = '<div style="font-size:9px;color:var(--dim);margin-top:6px">📡 Getting your location…</div>';

  if(!navigator.geolocation){ toast('Geolocation not available'); return; }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try{
        const resolved = await cat.resolve({lat:pos.coords.latitude, lng:pos.coords.longitude});
        const hiderVal = resolved?.val;
        if(!hiderVal){ toast('Could not determine your '+q.category_label); return; }
        const match = normKey(hiderVal) === normKey(q.seeker_val);
        const answer = match ? 'Yes' : 'No';
        const expl = `Your ${q.category_label}: <b>${hiderVal}</b> / Seeker's: <b>${q.seeker_val}</b> → <b>${answer.toUpperCase()}</b>`;
        hiderPickAnswer(answer, expl);
      } catch(e){ toast('Lookup failed: '+e.message); }
    },
    (err) => toast(err.code===1?'Location permission denied':'Location unavailable'),
    {enableHighAccuracy:true, timeout:10000, maximumAge:30000}
  );
}

async function hiderAutoNearestLookup(){
  const q = _hiderQ;
  if(!q || q.type !== 'nearest') return;
  const cat = NEAREST_CATS.find(c=>c.label === q.category);
  if(!cat){ toast('Unknown category'); return; }

  const btns = document.getElementById('hider-manual-btns');
  if(btns) btns.innerHTML = '<div style="font-size:9px;color:var(--dim);margin-top:6px">📡 Getting your location…</div>';

  if(!navigator.geolocation){ toast('Geolocation not available'); return; }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try{
        const loc = {lat:pos.coords.latitude, lng:pos.coords.longitude};
        if(btns) btns.innerHTML = '<div style="font-size:9px;color:var(--dim);margin-top:6px">🔍 Searching for nearest '+q.category_label+'…</div>';
        const items = await getCategoryInstances(cat, loc, 35000);
        if(!items.length){ toast('No '+q.category_label+' found near your location'); return; }
        const nearest = items.sort((a,b)=>turfDist(loc,a)-turfDist(loc,b))[0];
        const match = normKey(nearest.name) === normKey(q.seeker_poi.name);
        const answer = match ? 'Yes' : 'No';
        const expl = `Your nearest ${q.category_label}: <b>${nearest.name}</b> / Seeker's: <b>${q.seeker_poi.name}</b> → <b>${answer.toUpperCase()}</b>`;
        hiderPickAnswer(answer, expl);
      }catch(e){ toast('Lookup failed: '+e.message); }
    },
    (err) => toast(err.code===1?'Location permission denied':'Location unavailable'),
    {enableHighAccuracy:true, timeout:10000, maximumAge:30000}
  );
}

function hiderGPS(){
  if(!navigator.geolocation){ toast('Geolocation not available'); return; }
  const btn = document.getElementById('hider-gps-btn');
  btn.textContent = '⏳ Locating…'; btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      btn.textContent = '📡 Use My GPS Location'; btn.disabled = false;
      hiderSetLocation(pos.coords.latitude, pos.coords.longitude,
        `GPS (±${Math.round(pos.coords.accuracy)}m)`);
    },
    err => {
      btn.textContent = '📡 Use My GPS Location'; btn.disabled = false;
      toast(err.code===1?'Location permission denied':'Location unavailable');
    },
    {enableHighAccuracy:true, timeout:10000, maximumAge:30000}
  );
}

// Geo types: tap-map button
let _hiderPickingLocation = false;
function hiderTapMap(){
  _hiderPickingLocation = true;
  showBanner('TAP THE MAP — set your hiding location');
  document.getElementById('panel').classList.add('collapsed');
}

// Called from onMapClick when _hiderPickingLocation is true
function hiderSetLocation(lat, lng, label){
  _hiderPickingLocation = false;
  hideBanner();

  // Drop a purple marker
  if(_hiderLocMarker) _hiderLocMarker.remove();
  _hiderLocMarker = L.marker([lat,lng],{icon:hiderPin(),zIndexOffset:3000}).addTo(map);
  map.setView([lat,lng], Math.max(map.getZoom(),14));

  const locEl = document.getElementById('hider-loc-set');
  locEl.innerHTML = `📍 Location set: ${lat.toFixed(4)}, ${lng.toFixed(4)}${label?` — ${label}`:''}`;
  locEl.style.display = 'block';

  document.getElementById('panel').classList.remove('collapsed');
  switchTab('hider');

  // Auto-compute answer
  hiderComputeAnswer({lat,lng});
}

let _hiderLocMarker = null;

async function hiderComputeAnswer(hiderLoc){
  const q = _hiderQ;
  let answer, explanation;

  if(q.type === 'radar'){
    const d = turfDist(hiderLoc, q.center);
    answer = d <= q.radius_miles ? 'yes' : 'no';
    explanation = `You are ${d.toFixed(2)}mi from the radar center (radius: ${q.radius_miles}mi) → <b>${answer.toUpperCase()}</b>`;

  } else if(q.type === 'thermo'){
    const h = projectLocal(hiderLoc, q.center);
    const d = projectLocal(q.thermo_dest, q.center);
    const dot = h.x * d.x + h.y * d.y;
    answer = dot >= 0 ? 'closer' : 'further';
    explanation = `Using the travel direction from the seeker's current location, you are ${answer === 'closer' ? 'ahead of' : 'behind'} the divider line after a ${q.travel_miles}mi move → <b>${answer.toUpperCase()}</b>`;

  } else if(q.type === 'measure'){
    // Find hider's nearest instance from all_instances
    const instances = q.all_instances||[];
    if(!instances.length){ toast('No instances in question data'); return; }
    const nearest = instances.slice().sort((a,b)=>turfDist(hiderLoc,a)-turfDist(hiderLoc,b))[0];
    const hiderDist = turfDist(hiderLoc, nearest);
    const seekerDist = q.seeker_dist;
    answer = hiderDist <= seekerDist ? 'closer' : 'further';
    explanation = `Your nearest ${q.category_label}: <b>${nearest.name}</b> (${hiderDist.toFixed(2)}mi) / Seeker's: ${seekerDist.toFixed(2)}mi → <b>${answer.toUpperCase()}</b>`;

  } else if(q.type === 'tentacles'){
    const distToSeeker = turfDist(hiderLoc, q.center);
    if(distToSeeker > (q.radius_miles||1)){
      answer = 'no';
      explanation = `You are ${distToSeeker.toFixed(2)}mi from the seeker (radius: ${q.radius_miles||1}mi) → <b>NOT WITHIN RANGE</b>`;
    } else {
      // Find which option you're closest to
      let minDist = Infinity, closest = null;
      (q.options||[]).forEach(o => {
        const d = turfDist(hiderLoc, o);
        if(d < minDist){ minDist = d; closest = o.name; }
      });
      answer = closest;
      explanation = `You are within range (${distToSeeker.toFixed(2)}mi). Closest option: <b>${closest}</b> (${minDist.toFixed(2)}mi away)`;
    }
  }

  hiderPickAnswer(answer, explanation);
}

function _amDispatch(val){ hiderPickAnswer(val, null); }

function hiderPickAnswer(val, explanation){
  if(!_hiderQ) return;
  const answered = {..._hiderQ, answer: val};

  // Show result state
  document.getElementById('hider-locate-state').style.display = 'none';

  const def = QDEFS[_hiderQ.type];
  const banner = document.getElementById('hider-result-banner');
  document.getElementById('hrb-icon').textContent = '✅';
  document.getElementById('hrb-title').textContent = `Answer: ${String(val).toUpperCase()}`;
  document.getElementById('hrb-title').style.color = 'var(--green)';
  if(explanation){
    document.getElementById('hrb-sub').innerHTML = explanation;
  } else {
    document.getElementById('hrb-sub').textContent = `${def.label} answered`;
  }
  banner.style.borderColor = 'rgba(24,176,80,0.5)';
  banner.style.background  = 'rgba(24,176,80,0.08)';

  showHiderResult(JSON.stringify(answered, null, 2), null, null);
}

function openAnswerModal(q, def, isRandom=false){
  document.getElementById('am-eyebrow').textContent = isRandom ? 'Hider · Randomized Question' : 'Hider · Answer This Question';
  document.getElementById('am-title').textContent   = (isRandom ? '🎲 ' : '') + def.label;
  document.getElementById('am-body').innerHTML      = describeQuestion(q, def);
  document.querySelector('#answer-modal .card-btns').style.display = isRandom ? 'none' : 'flex';

  let opts = ANS_OPTS[q.type];
  if(q.type === 'tentacles'){
    opts = [{val:'no', label:'Not within range', icon:'❌', cls:'no'}];
    (q.options||[]).forEach(o => opts.push({val:o.name, label:o.name, icon:'📍', cls:'opt'}));
  }
  if(q.type === 'matching'){
    const clss=['yes','opt','no','opt'];
    opts = (q.answer_opts||['Yes','No']).map((v,i)=>({val:v, label:v, icon:i===0?'✅':'❌', cls:clss[i]||'opt'}));
  }
  opts = opts || [{val:'yes',label:'Yes',icon:'✅',cls:'yes'},{val:'no',label:'No',icon:'❌',cls:'no'}];

  document.getElementById('am-answers').innerHTML = opts.map(o => {
    const val = o.val;
    return `<button class="ans-btn ${o.cls}" onclick="_amDispatch(${JSON.stringify(val)})">
       <span class="ans-ico">${o.icon}</span><span>${o.label}</span>
     </button>`;
  }).join('');
  document.getElementById('answer-modal').classList.remove('hidden');
}

function describeQuestion(q, def){
  const m = {
    radar:     ()=>`Is the hider within <b>${q.radius_miles} mile${q.radius_miles!==1?'s':''}</b> of the seeker's location?`,
    thermo:    ()=>`After the seekers move <b>${q.travel_miles} mile${q.travel_miles!==1?'s':''}</b> in the chosen direction, are you on the <b>closer</b> side or the <b>further</b> side of the divider through their current location?`,
    measure:   ()=>`Are you closer or further from your nearest <b>${q.category_label}</b> than the seeker? (Seeker is <b>${q.seeker_dist?.toFixed(2)}mi</b> from theirs)`,
    tentacles: ()=>`Are you within <b>${q.radius_miles||1} mile</b> of the seeker? If yes — which of these are you closest to?<br><br>${(q.options||[]).map((o,i)=>`<b>${i+1}.</b> ${o.name}`).join('<br>')}`,
    matching:   ()=>`Are you in the same <b>${q.category_label}</b> as the seeker? (Seeker's: <b>${q.seeker_val}</b>)`,
    nearest:    ()=>`Is the nearest <b>${q.category_label}</b> to you the same as mine?<br>Mine is <b>${q.seeker_poi?.name}</b>.`,
    photo:     ()=>`📸 Please send a photo of: <b>${q.prompt}</b>`,
  };
  return (m[q.type]&&m[q.type]()) || def.label;
}

const QICONS = { radar:'📡', thermo:'🌡️', measure:'📏', tentacles:'🐙', matching:'🎱', nearest:'📌', photo:'📸' };
const QDESC  = {
  radar:     'Set your location and pick a radius — is the hider within that circle?',
  thermo:    'Set your current position, choose a move distance, and pick an endpoint on that ring. The divider through your current location splits the map into the travel-direction side (closer) and the opposite side (further).',
  measure:   'Pick a landmark type — the app finds the nearest one to you. Is the hider closer or further from it?',
  tentacles: 'Set your location — is the hider nearby? If yes, which of the found options are they closest to?',
  matching:  "Are you in the same county/city/neighborhood/ZIP as the seeker?",
  nearest:   'Is the nearest park/library/hospital/etc to you the same one as to the seeker?',
  photo:     'Pick a photo prompt. Ask the hider to send you a specific photo.',
};

function showHiderResult(json, cardType, randomQType){
  document.getElementById('hider-json-out').value = json;

  // Set the result banner
  const banner = document.getElementById('hider-result-banner');
  const icon   = document.getElementById('hrb-icon');
  const title  = document.getElementById('hrb-title');
  const sub    = document.getElementById('hrb-sub');

  if(cardType === 'veto'){
    banner.style.borderColor = 'rgba(232,64,64,0.5)';
    banner.style.background  = 'rgba(232,64,64,0.08)';
    icon.textContent  = '🚫';
    title.textContent = 'Veto Card Played';
    title.style.color = 'var(--accent)';
    sub.textContent   = 'This question is nullified. Send the JSON to seekers.';
  } else if(cardType === 'randomize'){
    const def = QDEFS[randomQType];
    banner.style.borderColor = 'rgba(160,96,255,0.5)';
    banner.style.background  = 'rgba(160,96,255,0.08)';
    icon.textContent  = '🎲';
    title.textContent = `Randomize Card — New type: ${def ? def.label : randomQType}`;
    title.style.color = 'var(--purple)';
    sub.textContent   = 'Send this to the seekers. They\'ll build the new question and send it back.';
  } else if(!cardType && icon.textContent !== '✅'){
    // Default — only set if hiderPickAnswer didn't already set it
    banner.style.borderColor = 'var(--border)';
    banner.style.background  = 'var(--panel2)';
    icon.textContent  = '✅';
    title.textContent = 'Answer Ready';
    title.style.color = 'var(--green)';
    sub.textContent   = 'Send this JSON back to the seekers.';
  }

  document.getElementById('hider-input-state').style.display  = 'none';
  document.getElementById('hider-locate-state').style.display = 'none';
  document.getElementById('hider-result-state').style.display = 'block';
  document.getElementById('panel').classList.remove('collapsed');
  switchTab('hider');
  toast(cardType === 'veto' ? 'Veto ready — copy and send!' : cardType === 'randomize' ? 'Randomize card ready — send to seekers!' : 'Answer ready — copy and send!');
}

function hiderReset(){
  document.getElementById('hider-json-in').value = '';
  document.getElementById('hider-input-state').style.display  = 'block';
  document.getElementById('hider-locate-state').style.display = 'none';
  document.getElementById('hider-result-state').style.display = 'none';
  document.getElementById('hider-loc-set').style.display = 'none';
  _hiderQ = null; _hiderPickingLocation = false;
  // Keep station — hider stays at same station between questions
  renderHiderStationBadge();
}

function copyHiderAnswer(){
  const json = document.getElementById('hider-json-out').value;
  navigator.clipboard.writeText(json)
    .then(()=>{ const fl=document.getElementById('hcf'); fl.classList.add('on'); setTimeout(()=>fl.classList.remove('on'),2200); toast('Copied! Send to the seekers.'); })
    .catch(()=>toast('Tap the text area and copy manually'));
}

function applyAnswerInline(){
  // Mirror applyAnswer but reads from the inline textarea and clears it on success
  const raw = document.getElementById('json-in-inline').value.trim();
  if(!raw){ toast('Paste the hider\'s answer JSON first'); return; }
  applyAnswerFromRaw(raw, ()=>{ document.getElementById('json-in-inline').value=''; resetBuild(); });
}

function closeAnswerModal(){
  document.getElementById('answer-modal').classList.add('hidden');
}

// ── Card prompts ──
function promptCard(type){
  _pendingCard = type;
  const isVeto = type === 'veto';
  document.getElementById('ci-icon').textContent  = isVeto ? '🚫' : '🎲';
  document.getElementById('ci-title').textContent = isVeto ? 'Use Veto Card?' : 'Use Randomize Card?';
  document.getElementById('ci-body').innerHTML    = isVeto
    ? 'This will <b>nullify the question</b>. The seekers get no information. You must have a Veto card in hand to use this.'
    : 'This will <b>replace the question</b> with a randomly generated one that you must answer. You must have a Randomize card in hand.';
  const btn = document.getElementById('ci-confirm-btn');
  btn.textContent = isVeto ? '🚫 Use Veto' : '🎲 Use Randomize';
  btn.className = `card-btn ${isVeto ? 'veto' : 'random'}`;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function closeConfirm(){
  document.getElementById('confirm-overlay').classList.add('hidden');
  _pendingCard = null;
}

function confirmCard(){
  const card = _pendingCard; // save BEFORE closeConfirm nulls it
  closeConfirm();
  closeAnswerModal();
  if(card === 'veto'){
    const payload = { type:'veto', original_id: _hiderQ?.id || null };
    showHiderResult(JSON.stringify(payload, null, 2), 'veto');
  } else if(card === 'randomize'){
    doRandomize();
  }
}

function doRandomize(){
  const types = ['radar','thermo','measure','tentacles','matching','photo'];
  const type  = types[Math.floor(Math.random() * types.length)];
  const payload = { type:'randomize_card', question_type: type, id:'rand'+Date.now().toString(36) };
  showHiderResult(JSON.stringify(payload, null, 2), 'randomize', type);
}
