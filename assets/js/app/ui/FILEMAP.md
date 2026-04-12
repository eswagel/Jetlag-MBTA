# App Script Map

## Bootstrap order

1. `assets/js/app/core/00-runtime.js`
2. `assets/js/app/core/01-geometry.js`
3. `assets/js/app/map/00-init.js`
4. `assets/js/app/map/01-mbta.js`
5. `assets/js/app/setup/00-zone.js`
6. `assets/js/app/build/01-build-data.js`
7. `assets/js/app/build/02-build-visuals.js`
8. `assets/js/app/build/03-build-ui.js`
9. `assets/js/app/build/04-build-actions.js`
10. `assets/js/app/04-build.js`
11. `assets/js/app/ui/shared.js`
12. `assets/js/app/ui/panel.js`
13. `assets/js/app/seeker/flow.js`
14. `assets/js/app/hider/flow.js`
15. `assets/js/app/07-bootstrap.js`

## This folder

- `assets/js/app/ui/shared.js`
- `assets/js/app/ui/panel.js`
- `assets/js/app/seeker/flow.js`
- `assets/js/app/hider/flow.js`

## Responsibilities

- `ui/shared.js` holds shared runtime helpers such as `toast()`, marker cleanup, and coordinate normalization.
- `ui/panel.js` owns the tab switcher, mobile panel collapse, and shell event wiring.
- `seeker/flow.js` owns question hydration, applying answers, build-state restoration, and log import/export.
- `hider/flow.js` owns question loading, location picking, hider answer resolution, and card handling.
