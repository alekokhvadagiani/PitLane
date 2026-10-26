# Roadmap

Phases are incremental proposals; ship independently verifiable slices.

| Phase | Outcome | Acceptance | Status |
| --- | --- | --- | --- |
| 1. Foundation | Handbook, design system, responsive shell, API health/capabilities, local/Compose setup | Builds; browser navigation and empty states verified; no invented data | Complete; container runtime verification pending |
| 2. Historical selection | OpenF1 session adapter, season/meeting/session picker, availability and provenance | Real response exercised; cancellation, throttling, errors, empty coverage and cache tested | Planned |
| 3. Circuit + timeline | Normalize one historical session; geometry provenance; position interpolation | UTC alignment and gap behavior tested; real positions rendered | Planned |
| 4. Replay | Clock, play/pause, seek/speed, timing/leaderboard | Deterministic seeking, synchronized events, efficient frame updates | Planned |
| 5. Radio | Available clips, filters, replay jumps | Missing recordings handled; timestamps and playback rights reviewed; no autoplay | Planned |
| 6. Telemetry | Per-lap comparisons, speed/throttle/brake/RPM/gear via lazy ECharts | Missing samples handled; distance/time alignment verified | Planned |
| 7. Live | Authenticated provider adapter, buffering and SignalR if useful | Paid access prerequisites explicit; reconnect, delay and stale data visible | Planned |
| 8. Polish | Profiling, accessibility, large sessions and offline/cache decisions | Measured budgets, keyboard and mobile verification | Planned |

Next useful increment: a bounded real OpenF1 historical session selector, backend adapter first. Do not introduce live access, a database, or Python before their requirements are validated.

## Foundation verification (2026-10-26)

.NET 10 Release build and formatting passed. Frontend strict TypeScript/build, lint and formatting passed. Six Playwright checks passed in installed Chrome, covering desktop and mobile navigation/history, session dialog keyboard focus, and API failure/retry. The running API returned real health/capability responses and 404 Problem Details. Desktop/mobile screenshots were reviewed. Compose configuration validates; container execution is pending because the local Docker daemon is not running. No historical/live integration, timeline, or audio has been implemented.
