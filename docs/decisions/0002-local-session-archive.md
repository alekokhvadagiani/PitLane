# ADR 0002: Local archive for finished sessions

Status: Accepted, 2026-10-28.

Replay requested OpenF1 in three-minute windows during playback. Each window cost one rate-limited request (3 per second observed), so seeking and long replays waited on the network, and a failed request left a gap until retried.

The API now keeps finished sessions on disk (`Archive:Path`, default `src/PitLane.Api/data/archive`, Git-ignored; a named volume in Compose). One folder per session key holds gzip-compressed JSON:

- Whole datasets: session, drivers, laps, stints, pit stops, race control, team radio links, results, classification, weather.
- Positions, car telemetry and intervals for every car in three-minute chunks aligned to the UTC clock (`positions/<chunk start ms>.json.gz`). Any later window, for any driver, is cut from these chunks.

`ArchivedHistoricalSessionProvider` sits in front of the OpenF1 provider: it reads from disk first, otherwise fetches (one request per file at a time) and saves. Only sessions that ended at least six hours ago are saved, because OpenF1 still revises recent data. Meeting and session catalogs stay memory-only. Writes are atomic, and an unreadable file is treated as missing.

`SessionDownloader` saves whole sessions in the background, one at a time, through the same request gate. Opening a finished replay queues its session (`POST /api/sessions/{key}/archive`); `POST /api/archive/seasons/{year}?include=races|all` queues a season; `GET /api/archive` lists what is stored and its size. A manifest marks a complete session. Team radio audio stays on F1's server: only the clip links are stored.

Plain files instead of PostgreSQL: the data is write-once per session and read by key and time, so a database would add a service without adding a query we need. Revisit when cross-session queries arrive.

Consequences: second and later visits, and the rest of a race once its download finishes, no longer wait on OpenF1. Measured on 2026-10-28 for China 2026 race (session 11245): 9.2 MB on disk (positions 4.4 MB, car data 4.2 MB, intervals 0.4 MB, 40 chunks each), saved in 213 seconds; three-minute windows then return in 2–40 ms from the local API. About 0.3 GB and two hours per season of races and sprints, assuming similar sessions. Saved data does not pick up later OpenF1 corrections; delete a session folder to fetch it again.
