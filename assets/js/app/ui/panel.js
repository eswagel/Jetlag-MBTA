// Tab shell wiring and mobile panel behavior.

function switchTab(name){
  const tabEl = document.querySelector(`.tab[data-tab="${name}"]`);
  if(tabEl && tabEl.style.display === 'none') return;

  if(name === 'boundary'){
    qtype = 'custom_boundary';
    qparams.custom_boundary_points = qparams.custom_boundary_points || [];
    if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
  }else if(qtype === 'custom_boundary'){
    qparams._drawingBoundary = false;
    hideBanner();
  }

  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('tab-' + name);
  if(pane) pane.style.display = 'block';
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
document.querySelectorAll('.qbtn').forEach(b => b.addEventListener('click', () => selectQType(b.dataset.q)));

const handleRow = document.getElementById('handle-row');
if(handleRow){
  handleRow.addEventListener('click', () => {
    if(window.innerWidth < 640){
      const panel = document.getElementById('panel');
      if(panel) panel.classList.toggle('collapsed');
    }
  });
}

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

const panelEl = document.getElementById('panel');
if(panelEl){
  new MutationObserver(syncMobileMapButton).observe(panelEl, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

window.addEventListener('resize', syncMobileMapButton);
syncMobileMapButton();
