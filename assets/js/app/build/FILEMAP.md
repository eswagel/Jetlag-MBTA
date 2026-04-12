# Build File Map

This folder holds the extracted pieces of the old `assets/js/app/04-build.js` monolith.

## Load order

Load these before `assets/js/app/04-build.js`:

1. `assets/js/app/build/01-build-data.js`
2. `assets/js/app/build/02-build-visuals.js`
3. `assets/js/app/build/03-build-ui.js`
4. `assets/js/app/build/04-build-actions.js`

Then load:

5. `assets/js/app/04-build.js`

## Responsibilities

- `01-build-data.js`
  Shared catalogs and query/data helpers.
  Includes matching/nearest/measure/tentacles category definitions, landmass and admin-boundary helpers, random question catalog helpers, and Overpass/Nominatim fetch helpers.

- `02-build-visuals.js`
  Shared map marker and display helpers.
  Includes build-mode marker icons, tentacle display helpers, and measure-line rendering helpers.

- `03-build-ui.js`
  Build panel rendering and non-destructive local interactions.
  Includes the build/body renderers, per-question-type parameter panels, thermo handle helpers, custom-boundary UI state, and pick restart logic.

- `04-build-actions.js`
  Async selection flows and question generation.
  Includes matching/nearest/measure/tentacles selection handlers, tentacle option resolution, question packet building, and JSON generation helpers.

- `../04-build.js`
  Preview/apply layer and shared build preview state.
  Includes answer preview rendering, direct-apply controls, custom-boundary preview/apply, and build reset/copy actions.
