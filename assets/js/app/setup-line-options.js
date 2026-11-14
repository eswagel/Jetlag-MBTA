const setupLineSelections = new Map();

function getSetupLineIds(){
  const profile = CITY_PROFILES[selectedCityId];
  const selected = setupLineSelections.get(profile.id);
  return selected
    ? profile.lines.filter(line => selected.has(line.id)).map(line => line.id)
    : defaultEnabledLineIds(profile.lines);
}

function renderSetupLineOptions(profile){
  const container = document.getElementById('setup-line-options');
  const selected = new Set(getSetupLineIds());
  const options = profile.lines.map(line => {
    const label = document.createElement('label');
    label.className = 'setup-line-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = line.id;
    checkbox.checked = selected.has(line.id);
    checkbox.addEventListener('change', () => {
      if(checkbox.checked) selected.add(line.id);
      else selected.delete(line.id);
      setupLineSelections.set(profile.id, selected);
      updateSetupLineAvailability(selected);
    });
    const swatch = document.createElement('span');
    swatch.className = 'setup-line-swatch';
    swatch.style.backgroundColor = line.color;
    swatch.setAttribute('aria-hidden', 'true');
    label.append(checkbox, swatch, document.createTextNode(line.label));
    return label;
  });
  container.replaceChildren(...options);
  updateSetupLineAvailability(selected);
}

function updateSetupLineAvailability(selected){
  const empty = selected.size === 0;
  document.getElementById('btn-start').disabled = empty;
  document.getElementById('setup-line-error').textContent = empty
    ? 'Select at least one transit line to start.'
    : '';
}
