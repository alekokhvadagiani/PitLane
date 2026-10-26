# Roadmap

Phases are incremental proposals; ship independently verifiable slices.

| Phase | Outcome | Acceptance | Status |
| --- | --- | --- | --- |
| 1. Foundation | Handbook, design system, responsive shell, API health/capabilities, local/Compose setup | Builds; browser navigation and empty states verified; no invented data | Complete; container runtime verification pending |
| 2. Historical selection | OpenF1 session adapter, season/meeting/session picker, availability and provenance | Real response exercised; cancellation, throttling, errors, empty coverage and cache tested | Catalog adapter and picker implemented; stream coverage validation pending |
| 3. Circuit + timeline | Normalize one historical session; geometry provenance; position interpolation | UTC alignment and gap behavior tested; real positions rendered | Planned |
| 4. Replay | Clock, play/pause, seek/speed, timing/leaderboard | Deterministic seeking, synchronized events, efficient frame updates | Planned |
| 5. Radio | Available clips, filters, replay jumps | Missing recordings handled; timestamps and playback rights reviewed; no autoplay | Planned |
| 6. Telemetry | Per-lap comparisons, speed/throttle/brake/RPM/gear via lazy ECharts | Missing samples handled; distance/time alignment verified | Planned |
| 7. Live | Authenticated provider adapter, buffering and SignalR if useful | Paid access prerequisites explicit; reconnect, delay and stale data visible | Planned |
| 8. Polish | Profiling, accessibility, large sessions and offline/cache decisions | Measured budgets, keyboard and mobile verification | Planned |

Next useful increment: probe bounded position and lap endpoints for a selected session, then model explicit per-stream coverage before building replay. Do not introduce live access, a database, or Python before their requirements are validated.

## Foundation verification (2026-10-26)

.NET 10 Release build and formatting passed. Frontend strict TypeScript/build, lint and formatting passed. Six Playwright checks passed in installed Chrome, covering desktop and mobile navigation/history, session dialog keyboard focus, and API failure/retry. The running API returned real health/capability responses and 404 Problem Details. Desktop/mobile screenshots were reviewed. Compose configuration validates; container execution is pending because the local Docker daemon is not running. No replay timeline or radio integration has been implemented.

## Historical catalog increment (2026-10-26)

Implemented `IHistoricalSessionProvider` with the OpenF1 historical meetings/sessions adapter, 30-minute in-memory caching, UTC retrieval provenance, request cancellation/timeout handling, year/key validation, and 503 Problem Details for provider failures. Replay mode browses real season/event/session metadata with search, URL-addressable selection, loading/error/retry, and empty states. Real API requests returned the 2025 OpenF1 catalog and Australian Grand Prix sessions after explicitly mapping the provider's snake_case JSON fields. Session selection does not load or imply position, timing, telemetry, or radio coverage. Backend Release build/format and frontend build/lint/format passed; browser rendering remains to be checked.
