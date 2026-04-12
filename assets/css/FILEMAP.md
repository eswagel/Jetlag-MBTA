# CSS File Map

- `app.css`: single stylesheet entry point used by `index.html`.
- `partials/00-foundation.css`: resets, CSS variables, map chrome, badges, and shared UI primitives.
- `partials/10-panel.css`: the bottom/right control panel and its question-builder controls.
- `partials/20-overlays.css`: setup overlay, modals, and other transient screens.

The partials are imported in numeric order to preserve the original cascade.
