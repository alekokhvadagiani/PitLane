# Architecture

## Foundation
PitLane is a local-first personal application. A React/Vite SPA calls a same-origin `/api` boundary backed by a .NET 10 minimal API. Vite proxies API requests in development; Nginx does so in Compose. The backend exposes health, truthful capability metadata, and a cached OpenF1 historical meeting/session catalog.

```text
React views ── TanStack Query ── /api ── ASP.NET Core
     │                                    │
shared visualizations             provider interfaces
     │                                    │
session clock                     OpenF1 historical catalog
```

One backend project is sufficient until complexity proves otherwise. No database, message broker, background worker, SignalR hub, or Python service is needed for the shell. No authentication is provided; bind development services to localhost.

## Planned session boundary
Use a provider-qualified session ID, UTC `DateTimeOffset` origin, optional end time, driver identities scoped to a session, and per-stream availability (`available`, `unavailable`, `unknown`, with reasons). Provider DTOs stay inside adapters; normalized models cross the API. A schedule entry is not evidence that replay data exists. Do not join providers on driver number alone.

The future timeline uses integer milliseconds relative to a documented UTC origin, retaining original provider timestamps and provenance. Position samples, lap events, timing changes, race control, pits, and radio share that origin. Stable ordering uses `(offsetMs, sourceSequence)`; preserve simultaneous events. Flag or reject invalid timestamps, document any offsets, and distinguish missing data from zero. Radio publication time may differ from the time spoken; verify its semantics before promising precise alignment.

Replay clock: `performance.now()` anchor plus session offset and speed; seek resets the anchor. Live clock: server-aligned session time minus a bounded jitter buffer. Both supply the same visualizers. A later timeline engine will be independently testable, with binary search, event cursors, gap-aware interpolation, and no extrapolation across large gaps. Clock/frame state belongs in refs or an external narrow subscription, not root React state. Render positions through SVG refs or Canvas; update text at an appropriate lower frequency.

## Provider resilience
`IHistoricalSessionProvider` isolates the OpenF1 adapter from API endpoints. `/api/meetings?year=` accepts years from 2023 through the current UTC year; `/api/meetings/{meetingKey}/sessions` returns session metadata; `/api/sessions/{sessionKey}/weather`, `/drivers`, `/laps?driverNumber=`, and `/positions?driverNumber=&fromUtc=&toUtc=` expose session data. Position windows are capped at three minutes. Catalog responses carry provider provenance and retrieval time. The adapter uses a 12-second HTTP timeout, propagates request cancellation, normalizes malformed/unavailable upstream responses to 503 Problem Details, and caches session/driver/range queries in memory for 30 minutes. Requests are bounded to one season, meeting, driver, or short interval. The UI also caches queries for 30 minutes and exposes retry controls.

The meeting/session catalog describes events and session timestamps only. Weather is separate timestamped context and does not establish that location, lap timing, telemetry, or radio streams exist. Preserve nullable measurements and gaps; OpenF1 rainfall is a binary reading, not a precipitation amount. Location requests are bounded to three minutes. `/race-positions` returns all drivers' location samples for one bounded window, `/classification` returns timestamped running-order changes, and `/car-data` returns selected-driver telemetry for one bounded window. Full-session replay advances through these windows; it does not fetch an entire race at once. Interpolate only between adjacent location samples less than 1.5 seconds apart. The plotted trace derives from provider-local X/Y coordinates and is not surveyed circuit geometry. OpenF1's `404 {"detail":"No results found."}` means that stream has no observations; normalize that specific response to an empty catalog, not a service outage. OpenF1 returned a 429 with a three-requests-per-second message during direct probing; a shared 450ms request gate spaces upstream calls. Treat observed limits as changeable, preserve `Retry-After`, and never replace provider failures or missing streams with synthetic race data.

## Frontend
Shared shell, button/dialog primitives, typed API transport, and URL-addressable Overview, Live, Replay, Telemetry, and Team Radio navigation. TanStack Query owns remote state. Motion is purposeful and honors reduced motion; fonts are bundled locally. Replay uses a compact session-browser dialog and a shared race workspace: timing tower, provider-derived circuit trace, selected-car instrument panel, and replay timeline. Track markers update through DOM refs on animation frames so the whole React tree is not rendered for each position frame. Missing streams remain explicit and replay controls stay disabled until position samples exist. Live, telemetry comparison, and radio currently show truthful availability states. The overview artwork is illustrative, not measured geography.

## Design system
Palette: asphalt `#08090c`, panel `#111419`, elevated `#1b2027`, rule `#303640`, text `#f4f5f7`, signal red `#f20d18`. Barlow Condensed provides compact motorsport display type; Manrope provides readable UI text with tabular numbers. A slim race-control header keeps navigation compact. The replay workspace uses a timing tower, dominant circuit, and selected-car instrument rail, with an integrated timeline below. Red marks primary action/selection; team colors identify drivers. Status is also conveyed with text. Mobile navigation stays available without a drawer and replay columns collapse into a circuit-first stack.

## Verification
Build and lint both codebases as applicable; browser-check 1920×1080, 1440×900, and mobile layouts, navigation, session dialog, failure states, and keyboard focus. Replay shell checks use test-only provider fixtures and do not establish upstream coverage or race accuracy.
