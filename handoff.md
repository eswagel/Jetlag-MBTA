# Jet Lag — current project handoff

Updated **2026-10-09**. This is the single continuation guide for the current project and the next Sites multiplayer phase. This replaces the obsolete Boston-only handoff; its historical contents remain available in Git.

## Repository state

- Canonical checkout: `/Users/ethan/Documents/Jetlag`
- Active branch: `main`
- Implementation baseline: **`d97ec9a` — Merge Chicago city profiles and shared gameplay into main**. Subsequent documentation commits do not change that tested implementation baseline.
- Chicago and the shared gameplay fixes are merged locally. The merge has **not been pushed to GitHub** as of this handoff.
- The recovery branch, integration branch and worker worktrees are retained for history. `/Users/ethan/.codex/worktrees/chicago-integration/Jetlag` is a pre-merge reference, not the checkout for continued development.
- The pre-merge pointer-only edit to this file was preserved in a stash named `Preserve pre-merge handoff pointer 2026-10-09`. It is superseded by this document; do not blindly reapply it.
- The working tree was clean before this documentation update. Check current status rather than relying on older handoffs' lists of uncommitted files.

## What exists

A static, build-free browser game supporting **Boston/MBTA and Chicago/CTA** with shared city profiles, category definitions and question mechanics. It uses vanilla JavaScript, Leaflet, Turf and a shared OpenFreeMap/MapLibre basemap. Serve it over HTTP because datasets load through `fetch()`.

Implemented flows include city selection with draggable transit-map cards, seeker/hider/dev modes, hiding-radius setup, question building and previews, manual JSON question/answer exchange, local save/resume, question history, log import/export, custom boundaries and hider location-based answers.

Radar, Thermometer, Measure, Tentacles, Matching and Nearest use the shared machinery. **Photo submission remains broken/deferred by explicit user choice**; do not count it as a functioning submission flow.

Most game geography is stored in `data/` for Boston and `data/chicago/` for Chicago. Source snapshots and generator scripts are retained. Basemap assets and some Boston geographic/elevation lookups still require online services; this is not a completely offline app.

## Code entry points

| Area | Files / mechanisms |
| --- | --- |
| Shell and layout | `index.html`, `assets/css/app.css` |
| City configuration and launcher | `assets/js/app/00-cities.js`, `00-city-picker.js` |
| Rules, storage, migrations | `01-core.js`: `QUESTION_CONTRACTS`, `deriveZoneStateFromConstraints`, `ensureQuestionDataReady`, saved-context migration |
| Map and setup | `02-map.js`, `03-setup.js` |
| Question builder and measurements | `04-build.js`: shared picking lifecycle, `resolveMeasurement`, preview/application |
| Hider workflow | `05-hider.js`: shared hydration, answering and GPS request recovery |
| Seeker ingestion/history | `06-seeker.js`: validation, hydration, answers, log import and replay |
| Chicago resolvers and service | `04-city-questions.js`, `chicago-service.js` |
| Geographic data generation | `scripts/`, `scripts/lib/`, `data/` |
| Regression coverage | `tests/` |

JavaScript files currently share globals and depend on script ordering. Reuse existing rules when adding server support; do not create parallel client/server implementations that drift.

## Gameplay rules to preserve

- A hider may move inside one fixed station catchment. Each ordinary location observation independently tests the entire catchment. Partial exclusions from different times must not accumulate into permanent station elimination.
- A station is eliminated if any one observation excludes its entire eligible catchment. Among surviving catchments, the latest location observation determines the green/orange split. Orange means currently excluded positions in a still-possible hiding station; red means outside all surviving catchments.
- Line questions test station identity, not the hider's current coordinates. Manual custom boundaries apply fixed geometry constraints. Photo has no spatial effect.
- Physical lines and branches are distinct. Branches of one physical line coalesce visually; different lines sharing track render alongside one another.
- Category IDs drive behavior; labels are presentation. Preserve legacy aliases at ingestion. Question contracts own transport/editor fields, defaults, validation, required data and migrations. Legacy hard/soft flags are compatibility-only.
- City/dataset versions and CTA service evidence stay pinned to the question. Never reinterpret old answers using a newly active timetable or different geography without an explicit migration.

- `resolveMeasurement` is shared by builders, imports and hider answers. `ensureQuestionDataReady` awaits required datasets before hydration/resume. Missing data must fail visibly rather than make a clue keep the whole map.
- Returned answers reconstruct missing context before application. Tentacles accepts only `no` or an actual in-range option ID; hider and seeker entry points share validation.
- Repicking, canceling and superseding asynchronous requests must invalidate their stale results.

## Merge results and compatibility

The merge retains main's Boston landmass and POI updates, ZIP normalization, municipality-aware neighborhood lookup and water-edge measurements, together with Chicago's shared engine. Both cities measure administrative borders against line segments. Boston water uses the shared conservative linear filter, not water centroids.

- Older unversioned Boston water-edge packets remain accepted. Versioned centroid-distance packets require rebuilding.
- Legacy border context is rebuilt on import/resume. Recorded answers remain unchanged and are flagged for review because the old distance calculation may have produced an incorrect answer; historical hider coordinates are unavailable.
- Main's compact v2 logs retain nested hiding radius, reconstructed custom-boundary polygons and hydrated matching geography.
- Materialized old make-red overrides migrate to fixed exclusions. Old make-green overrides and geometry-free indexed temporary-region selections explicitly block import/resume instead of silently disappearing. The old multi-select temporary-region UI is superseded by the current catchment mechanics.
- Missing data, invalid Tentacles answers and stale asynchronous results must not be treated as successfully applied clues. Failed GPS lookups restore manual/retry controls.

## Run and verify

```sh
cd /Users/ethan/Documents/Jetlag
git status --short
npm ci                 # if dependencies need installing
npm test
python3 -m http.server 8765 --bind 127.0.0.1
```

Check for an existing server before starting another, and verify which checkout it serves: an older process may still serve the integration worktree. Dev URLs are `/?city=boston&play=1&mode=dev` and `/?city=chicago&play=1&mode=dev`.

The user's existing browser game has used `http://127.0.0.1:8765`; browser QA has used `http://localhost:8765` to isolate saved state. Do not overwrite the user's game during testing.

**Recorded verification:** 254 Node tests passed on the merged implementation committed as `d97ec9a`. Three merge regressions cover legacy logs/manual overrides and Boston water-edge behavior. Pre-merge browser checks confirmed corrected Boston border distance, invalid-radius rejection and legacy elevation hydration; the merged result was checked by automated tests, not a new complete browser/field audit. No deployed multiplayer or real-world outing has been validated.

## Next phase: Sites multiplayer

The user deferred Sites until Chicago mechanics were established. Those changes are now merged. The user wants:

1. Backend games with unique private invitation codes and shareable links so friends can join without public game discovery.
2. Shared questions, answers, history and durable state, eliminating routine JSON copy/paste.
3. Server-enforced player roles and privacy: seekers must not receive private hider station/location data.
4. After shared transport works, a cleaner seeker menu with clear current-question status and better question/history UI.
5. Photo handling during the backend/shared-game phase, rather than repairing the old manual submission UI now.
6. Preserve the shared map appearance, city cards and reusable question mechanisms; do not split Boston and Chicago into separate apps.

No Sites project has been created or published in this work. The plan below distinguishes explicit requirements from implementation suggestions. Use the current installed Sites skills when implementation begins; this documentation update does not itself authorize deployment.

### Implementation approach

Use the installed Sites building/hosting skills and read their current persistence, authentication and execution-profile references. Their exact paths/versions can change. At handoff, Sites documents D1 for structured durable state and R2 for files, with platform-managed authentication options. Verify the supported access model for friends outside the owner's workspace before choosing a sign-in flow. Do not promise a specific login experience until checked.

Preserve the current frontend and data where practical. Introduce clear boundaries around the game rules and persistence/transport; do not rewrite the entire UI merely to fit a starter. Extract browser-independent rule functions where server validation requires them, reusing the same implementation and tests rather than maintaining server/client copies.

Proposed first complete multiplayer slice:

1. Create a game with city, dataset release and hiding radius; assign host/player roles.
2. Join by code or link, then persist membership and the assigned hider/seeker role.
3. Seekers draft/preview locally and send a canonical question to the game. Hiders receive it and submit an answer without JSON exchange.
4. Server validates identity, membership, role, question revision and answer; records the accepted event exactly once.
5. Every player retrieves the same ordered question/answer history and reconstructs the same public zone. Reconnect resumes durable state.
6. Replace the copy/paste-heavy seeker controls with a clear current-question area and readable history after this end-to-end flow works.

### Private game codes

Treat the join code as an invitation secret, not a sequential game ID. Use a cryptographically random, collision-checked code with enough entropy for the intended audience; a separate internal game ID is useful. Support normalized manual entry and a copyable invite link. Do not expose a public game directory, game existence details or membership lists to unauthenticated outsiders.

A code alone cannot guarantee that only friends join if it is guessed or forwarded. Recommended design: rate-limit join attempts, establish a per-player authenticated/session membership after joining, and permit the host to lock or rotate invitations. Host approval is an optional stricter mode, not a user decision already made. The invite must not grant host privileges or let a newcomer take an occupied hider role. Do not embed private game contents in the join URL.

Enforce permissions in every server endpoint; hiding UI controls is insufficient. Seekers must never receive private hider station/location data, including through logs, snapshots or event payloads. Prefer not to retain exact GPS coordinates unless a concrete gameplay need requires them.

### Shared-state model and synchronization

Suggested records: games, game members, canonical questions, answers/events, and optional photo metadata later. Pin city/data/rule versions per game. Store authoritative decisions/history centrally; browser storage may retain drafts and display preferences, not the shared game truth.

Use revision checks plus idempotent operation IDs so retries and two players clicking simultaneously cannot apply a question twice or overwrite newer state. Enforce a question lifecycle (draft locally, sent, answered, applied/canceled as appropriate). Define how edits, undo, veto and randomized questions are represented without silently rewriting another device's history.

Select synchronization based on verified Sites capabilities. Sparse polling with revision checks is an acceptable first implementation; do not assume WebSockets or a particular realtime database are available. Make reconnect and stale-state recovery explicit before adding more elaborate synchronization.

### Seeker UI after transport works

User-requested direction, not a finalized mockup:

- Remove routine JSON copy/paste controls from the primary game flow; import/export may remain in an advanced/debug surface.
- Keep drafting, previewing, sending, waiting for an answer and applying the result visibly distinct.
- Present the current question and its status clearly, with controls appropriate to the seeker's role.
- Provide readable question history with question details, answers and resulting map effects; make supported undo/correction actions understandable.
- Prioritize phone usability during actual play. Preserve the map's visual emphasis and existing city-card behavior.

### Multiplayer acceptance checks

- Two independent browser sessions join the same game by link and by manually entered code; invalid codes reveal no private state.
- Seekers cannot read private hider fields or perform hider/host-only operations through direct requests.
- Complete question/answer cycles in both cities without JSON transfer; exercise each question family and unchanged catchment semantics.
- Duplicate submissions, stale replies, simultaneous actions, reload, disconnect and reconnect preserve a consistent ordered history.
- Dataset-loading failures and unavailable live service fail clearly rather than changing question meaning.
- Existing regression tests remain passing, with new server authorization/concurrency and two-session integration tests.
- Mobile review confirms readable questions/history and workable map controls.

## Remaining limitations and references

- Live authenticated CTA behavior remains unverified in this work. The user had another agent investigating credentials; consult that work before duplicating it. Timetable fallback does not establish real-time special service. The initial saved calendar expires after November 30, 2026; verify the actual release before publishing.
- Chicago ZIP geography uses Census ZCTAs. POI coverage, elevation and conservative filtering have documented approximations. Boston point elevation may use the external USGS endpoint.
- Tests do not establish mobile-network performance, complete geographic accuracy, or multiplayer authorization correctness.
- Data provenance: [transit](docs/chicago-transit.md), [geography](docs/chicago-geography.md), [POIs](docs/chicago-pois.md), [Amtrak](docs/chicago-amtrak.md), [elevation](docs/chicago-elevation.md), [distance filtering](docs/linear-distance-filter.md).
- [Chicago implementation notes](docs/chicago-implementation.md) describe earlier milestones. This handoff and the current source take precedence over historical status statements.
