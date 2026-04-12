# App File Map

## Directly loaded by `index.html`

1. `core/00-runtime.js`
2. `core/01-geometry.js`
3. `map/00-init.js`
4. `map/01-mbta.js`
5. `setup/00-zone.js`
6. `build/01-build-data.js`
7. `build/02-build-visuals.js`
8. `build/03-build-ui.js`
9. `build/04-build-actions.js`
10. `04-build.js`
11. `ui/shared.js`
12. `ui/panel.js`
13. `seeker/flow.js`
14. `hider/flow.js`
15. `07-bootstrap.js`

## Legacy entry files

- `01-core.js`, `02-map.js`, `03-setup.js`, `05-hider.js`, and `06-seeker.js` are kept as small signposts so the old file names still point readers to the split runtime.
- `04-build.js` remains a real runtime file because it still owns the preview/apply layer.

## Folder responsibilities

- `core/`: shared state, persistence, dataset helpers, geometry primitives, and question definitions.
- `map/`: Leaflet setup plus MBTA and landmass loading.
- `setup/`: start-of-game flow, zone rendering, pick-banner flow, and map-click handling.
- `build/`: question-builder catalogs, rendering, visuals, async selectors, and JSON assembly.
- `ui/`: shell-level helpers and panel wiring.
- `seeker/`: loading questions, applying answers, restoring build state, and log management.
- `hider/`: question intake, auto-answer helpers, cards, and hider result flow.
