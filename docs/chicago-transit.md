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

Evaluation uses America/Chicago, GTFS calendar exceptions, service times above 24:00, and GTFS elapsed seconds from local noon minus 12 hours on DST dates. A weekday-only heuristic is never used. Ordinary line membership comes from the transit dataset; the service file intentionally covers Purple only. Purple now combines both local and express patterns as detailed below.

`validateSnapshot(snapshot, {lineId, stationIds, observedAt, maxAgeMs:120000})` performs structural, known-station, source/status, and timestamp validation. **It does not authenticate a claimed live source.** A caller must derive its own trusted live observation or recompute a schedule snapshot before relying on imported claims. Do not treat a serialized `source` string as evidence of a network request.

## Single Purple line and schedule fallback (current behavior)

Purple is now one question identity. The internal `Purple-Express` data entry remains a geometry/service-pattern variant, not a separate question. `ChicagoService.snapshot(calendar, 'Purple', timestamp)` unions active local and express trip patterns. The saved official GTFS schedule is an allowed, explicitly identified fallback; it never guesses express hours from weekdays alone. Out-of-coverage schedules remain unknown and cannot create Purple questions. A question retains its original observation time, station set, trip/service dates, source hash, and any live evidence through saving and JSON exchange. Incoming snapshots are recomputed from the matching saved timetable and replayed evidence. Legacy standalone Express questions must be rebuilt.

The browser first attempts the same-origin `/api/cta/trip-updates` endpoint. This may be overridden by `CHICAGO_CTA_TRIP_UPDATES_URL`, which must remain same-origin. Plain static hosting returns an unavailable endpoint and uses the saved schedule. To enable the implemented local proxy:

1. Request a CTA GTFS Realtime API key through https://transitdata.transitchicago.com/ / the CTA Developer Center.
2. Supply it as the server environment variable `CTA_GTFS_API_KEY` using your normal secret management (never commit or paste it into question JSON).
3. Run `python3 scripts/serve-chicago-live.py --port 8000` and open `http://127.0.0.1:8000/?city=chicago`.

The optional server binds only localhost, serves the app, and forwards the official fixed TripUpdates endpoint. It caches responses for 30 seconds, applies an upstream timeout, and does not log credential-bearing URLs. A missing key or upstream error returns a generic 503 and the app keeps its schedule fallback. For remote multiplayer hosting, deploy an equivalent credential-holding same-origin proxy; this local helper is not a production hosting service. **No API key was supplied during implementation, so a real authenticated upstream response has not been verified.** Tests use representative GTFS-RT fixtures and exercise proxy failure paths.

The runtime consumes actual `P`-route trip updates, maps platform IDs or trip-specific GTFS stop_sequence values to official parent stations, applies cancellations/skipped stops, and adds current positively reported stations, including stations absent from normal Purple patterns. Feed timestamps must be at most 120 seconds old (30 seconds future tolerance). Missing predictions do not mean inactive service: remaining scheduled trips are retained and the snapshot is labeled **CTA live observations + timetable**, with `source:'cta-gtfs-realtime+schedule'`, rather than purely live. Fallback snapshots use `source:'cta-gtfs-schedule'` and an explicit `fallbackReason`. Positive evidence for an otherwise unscheduled trip is limited to upcoming stops within 20 minutes. Service-date mismatches for active scheduled trips are ignored. Compact live evidence is preserved for reproducible peer-to-peer replay; it is not a cryptographically authenticated proof of the sender's network request.

### Cubs special stops

Do not hardcode Addison for every Cubs game. Current official sources conflict: the [Purple PDF timetable](https://www.transitchicago.com/assets/1/6/rail-tt_purple.pdf) and [Addison station page](https://lapi.transitchicago.com/station/adre/) mention Addison, while the [CTA sports page](https://www.transitchicago.com/sports/) and [2026 Cubs service announcement](https://www.transitchicago.com/the-return-of-the-crosstown-classic-take-the-cta-to-the-red-line-rivalry-to-watch-the-cubs-vs-white-sox/) mention Sheridan and direction-specific service. The app accepts whichever official station IDs appear in the current dated GTFS pattern or live trip updates. The saved feed currently has no Addison Purple pattern, so **schedule-only fallback cannot promise to capture unencoded game-day special stops**. Live fixtures verify that an actual added Addison stop becomes Purple membership without accidentally including bypassed Loyola. A current key and live feed are necessary to verify special service beyond the saved schedule.

Additional tests: `node --test tests/chicago-purple.test.cjs tests/chicago-questions.test.js` and `python3 tests/chicago-proxy.test.py`.
