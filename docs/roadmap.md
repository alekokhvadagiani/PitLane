# Roadmap

Phases are incremental proposals; ship independently verifiable slices.

| Phase | Outcome | Acceptance | Status |
| --- | --- | --- | --- |
| 1. Foundation | Handbook, design system, responsive shell, API health/capabilities, local/Compose setup | Builds; browser navigation and empty states verified; no invented data | Complete; container runtime verification pending |
| 2. Historical selection | OpenF1 season/meeting/session picker and timestamped weather context | Real response exercised; missing values, provider errors, and cache handled | Catalog and weather implemented; stream coverage validation pending |
| 3. Circuit + timeline | Normalize timestamped multi-driver position samples and render the provider-derived circuit trace | UTC offsets; gaps remain open; trace labeled as local coordinates | Circuit visualization, interpolation, and bounded multi-driver windows implemented; browser checks pass with test fixtures; upstream runtime coverage still needs validation |
| 4. Replay | Session-wide play/pause, seek, speed, synchronized running order and selected-car telemetry | Frame updates avoid full-tree renders; no extrapolation across gaps; bounded provider windows | Session clock, chunked position fetching, timestamped classification, selected-car telemetry, and timing workspace implemented; real-provider synchronization still needs validation |
| 5. Radio | Available clips, filters, replay jumps | Missing recordings handled; timestamps and playback rights reviewed; no autoplay | Planned |
| 6. Telemetry | Per-lap comparisons, speed/throttle/brake/RPM/gear via lazy ECharts | Missing samples handled; distance/time alignment verified | Planned |
| 7. Live | Authenticated provider adapter, buffering and SignalR if useful | Paid access prerequisites explicit; reconnect, delay and stale data visible | Planned |
| 8. Polish | Profiling, accessibility, large sessions and offline/cache decisions | Measured budgets, keyboard and mobile verification | Planned |

Next: ask the user to restart the API and frontend, then validate a completed historical race with the real provider. Check that play, seek, window changes, the running order, car markers, and telemetry stay synchronized. Upcoming sessions can have catalog metadata but no recorded position, classification, weather, or telemetry streams.

## Foundation verification (2026-10-26)

.NET 10 Release build and formatting passed. Frontend strict TypeScript/build, lint and formatting passed. Six Playwright checks passed in installed Chrome, covering desktop and mobile navigation/history, session dialog keyboard focus, and API failure/retry. The running API returned real health/capability responses and 404 Problem Details. Desktop/mobile screenshots were reviewed. Compose configuration validates; container execution is pending because the local Docker daemon is not running. No replay timeline or radio integration has been implemented.

## Historical catalog increment (2026-10-26)

Implemented `IHistoricalSessionProvider` with the OpenF1 historical meetings/sessions adapter, 30-minute in-memory caching, UTC retrieval provenance, request cancellation/timeout handling, year/key validation, and 503 Problem Details for provider failures. Replay mode browses real season/event/session metadata with search, URL-addressable selection, loading/error/retry, and empty states. Real API requests returned the 2025 OpenF1 catalog and Australian Grand Prix sessions after explicitly mapping the provider's snake_case JSON fields. Session selection does not load or imply position, timing, telemetry, or radio coverage. Backend Release build/format and frontend build/lint/format passed; browser rendering remains to be checked.

## Session weather and coverage probe (2026-10-26)

Added a cached OpenF1 session-weather endpoint and a selected-session Replay panel with latest conditions, timestamp, and air/track temperature history. The sampled Australian GP 2025 race returned 178 weather observations, 928 laps, and position data. A one-minute driver position window returned 221 records; an unbounded full-session query returned 39,559 records for one driver. Replay implementation should request driver-specific short windows and keep weather availability separate from position/lap coverage. .NET Release build, frontend lint/format/build, and real endpoint responses passed; browser rendering remains unchecked.

## Selected-lap replay increment (2026-10-26)

Added session driver discovery, per-driver lap timing, and a position endpoint capped at three minutes. Replay now plots the selected lap's actual OpenF1 local X/Y trace, reports returned lap/position coverage, shows lap and sector timing on a UTC-normalized event timeline, and supports play, pause, seek, restart, and 0.5×–4× playback. The car marker updates via animation frame and stops at gaps rather than extrapolating. This is selected-lap playback, not a full-session replay, leaderboard, or surveyed circuit map. Build/lint/format checks passed; no service was started for this increment, and browser rendering remains unchecked.

## Race workspace visual redesign (2026-10-26)

Replaced the sidebar/dashboard presentation with a compact race-control header and a circuit-centered replay workspace. The session browser is a searchable season/meeting/session dialog. Replay presents the real provider-derived track trace, selectable timing tower, sampled car instrument panel, play/pause/seek/speed controls, pit-out lap markers, and explicit coverage states. The overview and secondary modes use concise, honest status views; no synthetic racing data was added. Weather and lap analysis remain available as secondary disclosures. Responsive browser checks use test-only API fixtures at 1920×1080, 1440×900, and mobile; these do not verify upstream OpenF1 data or the user's local API.

Final checks: Node 24 frontend lint, Prettier check, TypeScript/Vite production build, and all 12 Playwright cases passed. Chrome screenshots were reviewed at the three configured sizes, including the mobile session drawer. Tests reused the already-running frontend; no API or frontend service was started. Real-session playback remains pending because the user's browser had provider 503 responses.
