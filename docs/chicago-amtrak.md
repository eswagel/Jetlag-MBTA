# Chicago Amtrak track reference

The pinned source is FRA/BTS NTAD Amtrak Routes, source release May 12, 2026, retrieved October 7, 2026. It represents Amtrak rail routes using North American Railroad Network centerlines at 1:24,000 or better. It is not station-to-station straight lines or a selection of generic freight tracks. Parallel tracks are represented by the route centerline; this is not a surveyed individual rail position or live rerouting feed. Some source route names are historical/duplicated (for example Capitol Limited and Floridian); overlapping geometry does not create additional distance targets.

Source: https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Amtrak_Routes/FeatureServer/0

`data/chicago/sources/amtrak-routes.json.gz` contains the original complete query response. Its separate manifest retains the query, retrieval date, and SHA-256 of uncompressed bytes. `node scripts/generate-chicago-amtrak.cjs` verifies the hash and regenerates only the Amtrak fields in `pois.json`, preserving all other categories. Regeneration is offline. Refresh by repeating the manifest query, checking pagination, then deliberately replacing the snapshot and hash together.

The reference rectangle extends beyond the game area. Original vertices are retained and segments are clipped without connecting disjoint paths. Tests distinguish Union Station track from the O'Hare CTA branch and check a sampled lower-bound margin against any omitted geometry outside the rectangle.
