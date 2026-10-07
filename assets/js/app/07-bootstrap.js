// ══════════════════════════════════════════════════════
//  TABS + WIRING
// ══════════════════════════════════════════════════════
function switchTab(name){
  // Don't switch to a tab that's hidden in current mode
  const tabEl = document.querySelector(`.tab[data-tab="${name}"]`);
  if(tabEl && tabEl.style.display === 'none') return;
  if(name === 'boundary'){
    qtype = 'custom_boundary';
    qparams.custom_boundary_points = qparams.custom_boundary_points || [];
    if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
  } else if(qtype === 'custom_boundary'){
    qparams._drawingBoundary = false;
    hideBanner();
  }
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.tab-pane').forEach(p=>p.style.display='none');
  const pane = document.getElementById('tab-'+name);
  if(pane) pane.style.display='block';
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
document.querySelectorAll('.qbtn').forEach(b=>b.addEventListener('click',()=>selectQType(b.dataset.q)));
document.getElementById('handle-row').addEventListener('click',()=>{if(window.innerWidth<640)document.getElementById('panel').classList.toggle('collapsed');});

function syncMobileMapButton(){
  const btn = document.getElementById('back-to-map-btn');
  const panel = document.getElementById('panel');
  if(!btn || !panel) return;
  const show = window.innerWidth < 640 && !panel.classList.contains('collapsed');
  btn.classList.toggle('visible', show);
}

function collapsePanelToMap(){
  const panel = document.getElementById('panel');
  if(!panel || window.innerWidth >= 640) return;
  panel.classList.add('collapsed');
  syncMobileMapButton();
}

new MutationObserver(syncMobileMapButton).observe(document.getElementById('panel'), {
  attributes: true,
  attributeFilter: ['class'],
});
window.addEventListener('resize', syncMobileMapButton);
syncMobileMapButton();

let toastTimer;
function toast(msg,ms=2400){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),ms);}
function clearMarkers(){
  pickedMarkers.forEach(m=>m.remove()); pickedMarkers=[];
  seekerPinMarkers.forEach(m=>m.remove()); seekerPinMarkers=[];
  if(thermoHandleMarker){ thermoHandleMarker.remove(); thermoHandleMarker = null; }
}
function clearPoiMarkers(){
  // Only clear POI teardrops, not the seeker location dot
  pickedMarkers.forEach(m=>m.remove()); pickedMarkers=[];
  if(thermoHandleMarker){ thermoHandleMarker.remove(); thermoHandleMarker = null; }
}

function onGameSessionReady(){
  if(!IS_GAME_SESSION || !mbdataReady) return;
  if(document.getElementById('resume-overlay').classList.contains('hidden')) startGame();
  else SessionLoading.ready();
}
renderCityProfile();
if(IS_GAME_SESSION){
  document.body.classList.add('game-session');
  SessionLoading.show(ACTIVE_CITY);
  const params = new URLSearchParams(window.location.search);
  const mode = [...document.querySelectorAll('.mode-card')].find(el=>el.dataset.mode===params.get('mode'));
  const radius = [...document.querySelectorAll('.radius-opt')].find(el=>Number(el.dataset.mi)===Number(params.get('radius')));
  if(mode) selectMode(mode);
  if(radius) selectRadius(radius);
  checkForResume();
  initMap();
  renderBuildBody();
  if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
}else{
  document.getElementById('setup-status-text').textContent = 'Choose a city, then start your game';
  document.getElementById('setup-dot').classList.add('ready');
  document.getElementById('btn-start').disabled = false;
}
