# Sites multiplayer handoff

Updated: 2026-10-09, after the merge into main. Read [the root handoff](../handoff.md) first for repository state; this document details the next multiplayer phase. Older implementation notes are historical where they disagree with these handoffs.

## Start here: correct checkout

- Active code: `/Users/ethan/Documents/Jetlag`
- Branch: `main` (Chicago integration merged on 2026-10-09)
- Verified implementation baseline: `d97ec9a` (`Merge Chicago city profiles and shared gameplay into main`), with 254 passing Node tests. Documentation commits may follow it.
- The merge is local and has not been pushed to GitHub as of this handoff.
- The original recovery branch and Chicago integration worktree are retained for history. Continue new development from `main`; the integration worktree is now a pre-merge reference.
- Inspect current status and applicable repository instructions before editing. Existing worker branches/worktrees are retained; do not assume their work is newer than the integration branch.
- No Sites project has been created or published for this adaptation in this conversation. This document records the agreed direction and proposed implementation, not completed multiplayer functionality.

## User intent and sequencing

The user originally deferred Sites until Chicago mechanics were established. Those mechanics and two rounds of shared-code fixes are now integrated. The next recommended development phase is a shared game on Sites that eliminates copying question/answer JSON between players.

Explicit latest requirements:

1. Each backend game gets a unique code. A friend can join using either the code or a link containing it.
2. Games should be private to invited players, not discoverable/browsable by strangers.
3. Once the shared-game workflow replaces copy/paste, clean up the seeker menu, with better question presentation and question history.
4. Photo submission is deliberately deferred until the shared-game/backend phase. The user specifically excluded the current Photo submission bug from the last fixes; do not represent it as fixed.
5. Preserve the existing map appearance, both cities, and reusable city/question mechanisms. Do not implement a separate Boston and Chicago app or city-specific copies of question logic.

The immediate request was to write this handoff. Implementation/publication is future work; this document itself is not an instruction to deploy now.

## Current application and code map

The app is vanilla HTML/CSS/JavaScript, served over HTTP with no frontend build required. Leaflet renders gameplay overlays over the shared OpenFreeMap/MapLibre basemap. Game geography is largely checked in; basemap assets remain online. Local browser storage currently owns saves, and JSON packets transport questions and answers manually.

| File | Responsibility / continuation point |
| --- | --- |
| `index.html`, `assets/css/app.css` | App shell, seeker/hider panels, styles; script ordering matters |
| `assets/js/app/00-cities.js` | City profiles, stable category identities, dataset metadata and compatibility |
| `assets/js/app/00-city-picker.js` | Reusable draggable city cards and session startup |
| `assets/js/app/01-core.js` | Shared question contracts, geometry/reduction, state, save/resume, dataset readiness, migrations |
| `assets/js/app/02-map.js` | Shared map/route/catchment rendering and map input |
| `assets/js/app/03-setup.js` | Modes, setup and hiding radius |
| `assets/js/app/04-build.js` | Seeker builder, common picking lifecycle, `resolveMeasurement`, previews and local application |
| `assets/js/app/05-hider.js` | Hider loading, location lookup, answering and request cancellation |
| `assets/js/app/06-seeker.js` | Hydration, validation, returned-answer application, logs, import and replay |
| `assets/js/app/04-city-questions.js` | Chicago geographic/service resolvers; no longer monkeypatches shared category arrays/functions |
| `assets/js/app/chicago-service.js` | CTA service evaluation and evidence snapshots |
| `data/`, `data/chicago/`, `scripts/` | Versioned local datasets and reproducible generators |
| `tests/` | Node regression suite using real application functions; some DOM/source/provider behavior is stubbed |

Consult `docs/chicago-transit.md`, `chicago-geography.md`, `chicago-pois.md`, `chicago-amtrak.md`, `chicago-elevation.md`, and `linear-distance-filter.md` for data provenance/limits. `docs/chicago-implementation.md` is useful background, but its older hard/soft description is superseded by the rules below.

## Mechanics that must survive the port

- A hider can move within one fixed station catchment. Each ordinary location observation independently tests that catchment. Two disjoint partial exclusions at different times must NOT combine to eliminate the station permanently.
- Any single observation incompatible with the entire catchment eliminates that station. The latest location observation supplies the green/orange split among surviving catchments. Orange means currently excluded positions within a still-possible hiding station; red means outside every surviving catchment.
- Line questions concern immutable station membership, not the hider's momentary location. Apply station identity before geometry. Distinguish physical lines from branches: shared branches of one line coalesce; different interlining lines render alongside one another.
- Manual custom boundaries are fixed exclusions. Photo does not alter spatial constraints.
- Shared contracts define fields, defaults, serialization, editor restoration, answer validation, required datasets and context migration. Stable category IDs drive behavior; display labels are not identifiers. Preserve legacy label aliases at ingestion.
- `resolveMeasurement` is shared by builder, import and hider. Both cities now measure administrative borders to actual line segments, not polygon vertices.
- `ensureQuestionDataReady` waits for declared geographic prerequisites before hydration/resume. A missing dataset must fail visibly without treating a clue as keeping the whole map.
- Returned answers hydrate missing question context before application. Tentacles accepts only `no` or an actual in-range option ID. Hider input uses the same hydration/validation path as seeker input.
- Picking changes, canceled requests and superseded asynchronous operations cannot restore stale question context. Failed GPS lookups restore retry/manual controls.
- Keep city/dataset versions and CTA service snapshots pinned. Do not replay old line answers against whichever live service happens to be active now.
- Legacy hard/soft fields are wire-compatibility metadata only, not a second gameplay policy.

Important migration limitation: old saved Boston border questions may contain incorrect vertex-based distances. Resume migrates constraints, outgoing questions and builder context before changing live state. Recorded answers are preserved and flagged for review: the hider's historical location was not saved, so those answers cannot be retroactively verified. Log import also reconstructs border geometry.

## Recommended Sites implementation

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

## Verification and acceptance

Last completed implementation suite: **254 tests passed on the merged implementation committed as `d97ec9a`**. This is a recorded result, not a claim of a fresh test run whenever this document is read. Pre-merge browser checks confirmed Boston's Malden border midpoint now reports 0.00 miles (previously 1.32), negative hider radar radius is rejected, and a legacy elevation question without an explicit mode loads correctly. The merged result passed automated tests; no new complete browser audit was performed after merging. There has been no full real-world outing or deployed multiplayer test.

```sh
cd /Users/ethan/Documents/Jetlag
npm ci                 # only if dependencies need installation
npm test
python3 -m http.server 8765 --bind 127.0.0.1
```

Check whether a server already occupies the port before starting another. Dev entry: `/?city=boston&play=1&mode=dev` or `/?city=chicago&play=1&mode=dev`. Existing user gameplay has used `http://127.0.0.1:8765`; isolated browser QA has used `http://localhost:8765` so it does not overwrite the user's saves. Inspect current sessions instead of assuming old servers are still running.

Acceptance for the first Sites version:

- Two independent browser sessions join the same game by link and by manually entered code; invalid codes reveal no private state.
- Seekers cannot read private hider fields or perform hider/host-only operations through direct requests.
- Complete question/answer cycles in both cities without JSON transfer; exercise each question family and unchanged catchment semantics.
- Duplicate submissions, stale replies, simultaneous actions, reload, disconnect and reconnect preserve a consistent ordered history.
- Dataset-loading failures and unavailable live service fail clearly rather than changing question meaning.
- Existing regression tests remain passing, with new server authorization/concurrency and two-session integration tests.
- Mobile review confirms readable questions/history and workable map controls.

## Remaining known limits / deferred work

- Photo's current manual button handler is broken and intentionally left alone at the user's request. Build the proper shared-game photo flow later; R2 is the documented candidate for image bytes, with database metadata and role-checked access.
- Live CTA authenticated behavior was not verified in this work; the user previously had another agent working on credentials. Check that work before duplicating it. Do not claim timetable fallback proves live Cubs-game special stops. The initially saved calendar expires after November 30, 2026; verify current data before publishing.
- Chicago ZIP areas are Census ZCTAs, not exact USPS delivery boundaries. OSM POIs, terrain grids and adaptive filters have documented approximation/coverage limits.
- Boston point elevation lookup can depend on the external USGS endpoint; local game data does not imply every operation is offline.
- Passing tests do not replace field playtesting, mobile-network testing, or shared-game security checks.

## Merge into main (2026-10-09)

The merge preserves main's Boston landmass/POI updates, ZIP normalization, municipality-aware neighborhood lookup, and water-edge measurement, using the shared city engine. Boston water now uses the same conservative linear filter as Chicago; older unversioned edge-distance packets remain accepted, while versioned centroid-distance packets require rebuilding. The newer catchment semantics supersede the old multi-select temporary-region UI. Materialized legacy make-red overrides migrate to fixed exclusions; old make-green overrides or geometry-free indexed selections explicitly block resume/import rather than being silently ignored.
