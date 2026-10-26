# Architecture

## Foundation
PitLane is a local-first personal application. A React/Vite SPA calls a same-origin `/api` boundary backed by a .NET 10 minimal API. Vite proxies API requests in development; Nginx does so in Compose. The backend currently exposes health and truthful capability metadata only. It does not call race providers.

```text
React views ── TanStack Query ── /api ── ASP.NET Core
     │                                    │
shared visualizations             provider interfaces (future)
     │                                    │
session clock                     OpenF1 / Jolpica adapters
```

One backend project is sufficient until complexity proves otherwise. No database, message broker, background worker, SignalR hub, or Python service is needed for the shell. No authentication is provided; bind development services to localhost.

## Planned session boundary
Use a provider-qualified session ID, UTC `DateTimeOffset` origin, optional end time, driver identities scoped to a session, and per-stream availability (`available`, `unavailable`, `unknown`, with reasons). Provider DTOs stay inside adapters; normalized models cross the API. A schedule entry is not evidence that replay data exists. Do not join providers on driver number alone.

The future timeline uses integer milliseconds relative to a documented UTC origin, retaining original provider timestamps and provenance. Position samples, lap events, timing changes, race control, pits, and radio share that origin. Stable ordering uses `(offsetMs, sourceSequence)`; preserve simultaneous events. Flag or reject invalid timestamps, document any offsets, and distinguish missing data from zero. Radio publication time may differ from the time spoken; verify its semantics before promising precise alignment.

Replay clock: `performance.now()` anchor plus session offset and speed; seek resets the anchor. Live clock: server-aligned session time minus a bounded jitter buffer. Both supply the same visualizers. A later timeline engine will be independently testable, with binary search, event cursors, gap-aware interpolation, and no extrapolation across large gaps. Clock/frame state belongs in refs or an external narrow subscription, not root React state. Render positions through SVG refs or Canvas; update text at an appropriate lower frequency.

## Provider resilience (planned)
Start with OpenF1 historical session discovery. Add a concrete adapter and contract tests together, with cancellation, request timeout, a shared request budget, bounded cache, in-flight deduplication, 429/Retry-After handling, and capped retry backoff. Query telemetry by session/driver/time window. Never download every car's full session on initial navigation. Validate response shape and expose partial availability separately from upstream failure. Never replace failed provider responses with synthetic race data.

## Frontend
Shared shell, button/dialog primitives, typed capability transport, four URL-addressable modes. TanStack Query owns capability loading/error state. Mode navigation is represented in the URL and browser history. Motion is limited to a short entrance and honors reduced motion. Fonts are bundled locally. Circuit artwork is an explicitly labeled illustration, not measured geography. Playback controls stay disabled until real session data is available.

## Design system
Palette: asphalt `#090b0e`, panel `#101318`, elevated `#171b21`, rule `#272c34`, text `#f2f3f5`, signal red `#f04438`. Barlow Condensed provides compact motorsport display type; Manrope provides readable UI text with tabular numbers. Left-aligned layouts, 4/8px spacing rhythm, a quiet sidebar, and a large circuit workspace define the application. Borders encode panel hierarchy, red denotes primary action/selection, and textual status never depends on color alone. Mobile navigation stays available without a drawer.

## Verification
Build and lint both codebases as applicable; browser-check desktop/mobile layout, navigation, dialogs, failure states, and keyboard focus. Domain tests arrive with actual timeline/provider behavior. Foundation checks must never be described as proof of race accuracy.
