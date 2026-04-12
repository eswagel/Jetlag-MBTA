# File Map

## Top level

- `index.html`: single-page MBTA hide-and-seek UI. Loads the split runtime directly with classic script tags.
- `assets/`: browser assets for the app.
- `data/`: precomputed MBTA, POI, boundary, landmass, and elevation datasets used at runtime.
- `scripts/`: one-off generators for the files in `data/`.
- `package.json`: generator dependencies and dataset build scripts.

## Runtime path

1. `index.html` loads CSS from `assets/css/app.css`.
2. `index.html` loads classic scripts from `assets/js/app/...` in a fixed order.
3. `assets/js/app/07-bootstrap.js` starts the app after all split files are loaded.

See also:

- `assets/FILEMAP.md`
- `assets/js/app/FILEMAP.md`
- `assets/css/FILEMAP.md`
