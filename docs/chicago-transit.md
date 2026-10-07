# Chicago transit data

Regenerate with `python3 scripts/generate-chicago-transit.py`. Python 3.9+ and curl are required; no Python packages. Downloads are cached in `/tmp/jetlag-gtfs-cache`; `--cache-dir PATH` selects a persistent replay archive and `--refresh` explicitly replaces it. Preserve this cache to reproduce a particular release byte-for-byte. Outputs carry each original feed URL, retrieval timestamp, and SHA-256. The generator validates archives before caching. It never stores credentials. The website serves the generated JSON, not requests directly to agencies.

Official inputs:

- CTA: https://www.transitchicago.com/downloads/sch_data/google_transit.zip
- Metra: https://schedules.metrarail.com/gtfs/schedule.zip
- South Shore: https://www.mysouthshoreline.com/google/google_transit.zip

The first snapshot contains **143 CTA parent-station IDs**, 239 served Metra stop IDs, and 21 served South Shore stop IDs. CTA parent stations are the agency's facilities, not a count of separate platforms or route station listings. No name-based deduplication occurs. Commuter stations are references only; all supplied served stations are retained, including those beyond the CTA play area. The raw Metra stop list includes two unserved stops which are omitted because they have no stop_times entries.

`transit.json` retains the existing `lines`, `shapePath` ([latitude, longitude]), `stops`, `commuterRail`, and object `bbox` schema. CTA station IDs are official parent IDs, commuter IDs are agency-prefixed. Line IDs are Red, Blue, Brown, Orange, Pink, Yellow, Green-Ashland, Green-Cottage, Purple, Purple-Express. Southern Green branch membership follows complete GTFS trips to Ashland/63rd and Cottage Grove respectively; both include their shared trunk. Unidentifiable short-turn Green trips do not create branch membership. Purple trips reaching south of Howard are express; other trips are local. Stations along bypassed track do not become express stops. Map geometry uses the longest stop pattern's most-used GTFS shape, rather than drawing artificial straight connections between disjoint patterns; geometry is a reference route, not live rerouting.

`service-calendar.json` preserves Purple trip IDs, station patterns, trip start/end seconds, calendar weekdays, date bounds, and exception dates. Initial coverage is **2026-09-11 through 2026-11-30**. It must be refreshed for games beyond this range. These are scheduled service patterns, **not proof of actual active service**.

## Runtime interface

Load `assets/js/app/chicago-service.js` and fetch `data/chicago/service-calendar.json` once. `ChicagoService.snapshot(calendar, 'Purple-Express', observedAt)` returns:

- `observedAt`: normalized ISO timestamp; retain the question's timestamp and snapshot for replay.
- `source`: `cta-gtfs-schedule`.
- `status`: `scheduled-active`, `scheduled-inactive`, or `unknown`.
- `stationIds`: union of the station patterns of trips whose scheduled start/end interval contains the timestamp, end exclusive. This represents stations served by currently scheduled runs, not a claim that a train is currently at every station.
- `feedVersion`: exact source archive hash, with active `tripIds` for audit.
- `reason` when unknown (missing schedule, invalid time, unsupported line, outside coverage).

Evaluation uses America/Chicago, GTFS calendar exceptions, service times above 24:00, and GTFS elapsed seconds from local noon minus 12 hours on DST dates. A weekday-only heuristic is never used. Ordinary line membership comes from the transit dataset; the service file intentionally covers Purple only.

`validateSnapshot(snapshot, {lineId, stationIds, observedAt, maxAgeMs:120000})` performs structural, known-station, source/status, and timestamp validation. **It does not authenticate a claimed live source.** A caller must derive its own trusted live observation or recompute a schedule snapshot before relying on imported claims. Do not treat a serialized `source` string as evidence of a network request.

## Live service remains a separate integration

The official https://transitdata.transitchicago.com/ landing page confirms that `GtfsRealtime/TripUpdates.json`, `VehiclePositions.json`, and `ServiceAlerts.json` all require an API key. The legacy https://www.transitchicago.com/developers/traintracker/ API also requires a key. There is no credential in this project and no backend in this scope. Do not embed one in public JS or question JSON.

CTA notes predictions may be withheld during disruptions, may be absent before a train leaves a terminal, and sometimes contain scheduled rather than predicted departures. Thus missing predictions cannot establish inactive service. A future trusted adapter must combine current trips/stop patterns, cancellations/skipped stops, and alerts, returning explicit unknown when evidence is insufficient. Until then, the UI must identify schedule estimates and must not present Purple Express answers as confirmed live activity.

Run validation with `node --test tests/chicago-transit.test.cjs`. It checks reference agency coverage, stable IDs, branch exclusions and shared trunk, actual current schedule weekday/weekend differences, out-of-coverage behavior, calendar exceptions, DST, previous-service-day trips, and snapshot structure. Re-running the generator against the same cache yields identical JSON.
