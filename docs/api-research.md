# Provider evaluation

Reviewed 2026-10-26 against official documentation. Findings are design inputs, not proof of an implemented integration. Recheck before implementing; access and terms can change.

| Provider | Best fit | Coverage / access | Limitations and decision |
| --- | --- | --- | --- |
| OpenF1 | Historical session streams, car location, laps, stints, control messages, available radio | Free unauthenticated history from 2023; real-time requires paid subscription | First historical adapter. Car samples are roughly 3.7 Hz, not simulation-grade. Radio is partial and 2026 coverage has declined sharply. UTC timestamps; retain gaps. |
| Jolpica | Calendar, results, standings, lap/pit history | Ergast-compatible API; public noncommercial access; history reaches 1950 | Not a continuous position/telemetry feed. 4 requests/second and 500/hour unauthenticated; mutable limits. Default page 30, maximum 100; follow offsets. Required app/version User-Agent. |
| FastF1 | Rich Python analysis/import workflows | Python library over upstream sources; timing/telemetry availability is session-dependent | Avoid a Python runtime service now. Caching and upstream rate limiting are built in. Source head now references F1-account authentication for timing; evaluate a pinned release and access requirements before adoption. |

Sources: [OpenF1 official docs](https://openf1.org/docs/), [Jolpica docs](https://github.com/jolpica/jolpica-f1/blob/main/docs/README.md), [rate limits](https://github.com/jolpica/jolpica-f1/blob/main/docs/rate_limits.md), [terms](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md). Jolpica data terms specify CC BY-NC-SA 4.0; distinguish software licensing from data licensing.

The [FastF1 documentation site](https://docs.fastf1.dev/) returned HTTP 403 to the research browser. Its [official documentation source](https://github.com/theOehrly/Fast-F1/blob/master/docs/index.rst), [README](https://github.com/theOehrly/Fast-F1/blob/master/README.md), and [request/cache implementation](https://github.com/theOehrly/Fast-F1/blob/master/fastf1/req.py) were accessible. Source-head details are provisional, not guarantees for a released version. Do not assume that pre-2018 schedule history includes telemetry. A pinned-release coverage/authentication evaluation remains open.

## Access and data policy
- OpenF1's reviewed documentation did not establish a numeric rate quota. Do not invent one: use bounded concurrency, caching, small time windows, and respect 429/Retry-After. Confirm current subscription transport/authentication when implementing live.
- Use UTC instants, not local wall-clock strings. Check session origins and radio timestamp meaning against actual responses. Driver numbers and provider IDs are not globally interchangeable.
- Missing telemetry is null/unavailable; avoid interpolation across long gaps or comparing unaligned lap samples. Location is provider-local coordinates, not automatically GPS or authoritative track geometry.
- Radio URLs do not establish playback/republication rights. Before audio integration, review applicable upstream terms, expose only available clips, handle removed/expired URLs and browser playback errors, avoid autoplay, and do not download or redistribute a radio archive by default.
- Historical cache should be bounded and keyed by provider, session, stream, version and window. Report stale/partial data; failures must never become fake success.

## Next validation
Exercise one OpenF1 session discovery request through a concrete backend adapter, preserving response provenance; then fetch bounded driver/lap/location windows and measure payload sizes, gaps, timestamps, quota behavior and coordinate scaling. No external API runtime calls are part of Phase 1.
