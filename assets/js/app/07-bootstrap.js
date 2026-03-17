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

let toastTimer;
function toast(msg,ms=2400){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('on'),ms);}
function clearMarkers(){
  pickedMarkers.forEach(m=>m.remove()); pickedMarkers=[];
  seekerPinMarkers.forEach(m=>m.remove()); seekerPinMarkers=[];
}
function clearPoiMarkers(){
  // Only clear POI teardrops, not the seeker location dot
  pickedMarkers.forEach(m=>m.remove()); pickedMarkers=[];
}

initMap();
renderBuildBody();
if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
checkForResume();
