# Bounded line-distance map filtering

`linear-distance-filter.js` is a shared geography-independent engine. A city profile opts a category into it with:

```js
measureFilters: {
  'A Body of Water': {
    mode: 'adaptive-linear',
    version: 'adaptive-linear-v1',
    dataKey: 'bodiesOfWaterLines',
  },
}
```

The source is the profile's ordinary POI JSON, containing LineString/MultiLineString GeoJSON features at that key. No Chicago identity checks are used by the engine. Boston's existing distance categories retain their current behavior unless its profile explicitly opts into the new engine.

## What a retained area means

Seeker and hider answers still compare distance to the nearest actual mapped edge using the shared nearest-point calculation. The map performs **conservative elimination**, not a smoothed approximation of a vector buffer. It removes only whole cells proved incompatible with the answer. Cells too close to the distance boundary, or still unresolved when the resource budget is reached, remain in play for **both** answers. Consequently the map may retain an extra band or patches; it does not eliminate a true location merely because a small lake, bend or narrow shoreline was simplified away.

The build panel, calculation toast and question log explain that uncertainty is retained. Do not describe the resulting map as an exact buffer or promise a uniform 20-meter resolution. Twenty meters is the target maximum cell diameter **when resources permit**. The full-envelope stress case can retain cells approximately 564 meters across; a 0.25-mile Loop station region reached less than 50 meters in the regression test. Region size, threshold and shoreline complexity determine the actual result. The result exposes `stats.maxUncertainDiameterMeters`, `uncertainCells`, `cells`, and resource limits for inspection.

## Method and resource bounds

1. Build a balanced spatial tree over the original source segments. Its spherical caps cover entire geodesic segments, so a nearest-distance query can prune distant branches while preserving the same nearest-edge measurement. No reference line is clipped to the playable extent before measuring; a nearest shore outside it still counts.
2. Start from bounding rectangles of the zone's connected polygon components. Holes and unrelated parts of those rectangles are harmless: the final exclusions are subtracted from the original zone.
3. Visit cells breadth-first. Distance-to-a-set is 1-Lipschitz, so `center distance ± cell cap radius` bounds the distance everywhere in a cell. Include an additional two-meter numerical margin. Certify wholly closer/further cells; subdivide ambiguous cells while budget remains.
4. Dissolve the certified rectangles separately into the exclusions for each answer. Uncertain cells are absent from both exclusions. There is no giant shoreline-buffer operation or geometric boundary simplification.

The defaults limit each calculation to 24,000 distance-tested cells, depth 14, and 250,000 input segments. Unsupported oversized/antimeridian/high-polar inputs fail explicitly. At most four results are cached; source indexes are weakly keyed by the source array. Algorithm results are deterministic for the same source, threshold, extent, Turf version and options. `linear_filter_version` travels in question packets and full saved questions; the several-megabyte source geometry is referenced through the profile and is not copied into question or build-state saves. Resume/import loads the local dataset before applying the filter. A mismatched or missing version is rejected during import rather than silently reinterpreted.

The algorithm is still synchronous. A calculation toast is displayed before preview/apply work; it can pause the main thread for several seconds on the full envelope, and low-end phone timing is not yet established. The bounded cell calculation replaces a confirmed ~4GB heap failure. Further responsiveness work can move this same shared implementation into a worker without changing its uncertainty policy.

## Validation and observed performance

`tests/linear-distance-filter.test.cjs` covers complete-source versus indexed distance, no incorrect elimination for closer/further answers, zero radius, tiny budgets, disconnected extents, nearby reference lines outside the zone, deterministic replay, invalid inputs and actual Chicago source performance. The integration tests cover packet creation, reconstruction, version rejection, unchanged Boston behavior and another profile opting into the shared engine.

Measured on the development machine using all **189,121 Chicago water segments** and the entire `[-88,41.60,-87.48,42.12]` envelope at a 0.3-mile threshold:

- Turf 7 isolated test: approximately **1.9 seconds**, **242 MiB RSS**, **23,997 cells**.
- Browser's actual Turf 6.5.0 loaded in Node: approximately **3.1 seconds**, **225 MiB RSS**, **23,997 cells**; indexed distances matched complete-geometry distances at sampled locations.
- Parallel full-suite run: approximately **5.1 seconds**, **250 MiB RSS** for the stress test.

For comparison, split vector buffers followed by balanced spatial unions took approximately 12.5 seconds / 260MB RSS; the old single huge MultiLineString buffer exhausted a ~4GB heap. Tests impose a 15-second desktop stress threshold and a 512MiB peak-RSS ceiling. These timings are measurements, not phone-performance guarantees. No water geometry or source definitions were changed.
