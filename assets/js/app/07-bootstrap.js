// Runtime entry point after the split scripts are loaded by index.html.
(function bootstrapApp(){
  initMap();
  renderBuildBody();
  if(typeof renderBoundaryBody === 'function') renderBoundaryBody();
  checkForResume();
})();
