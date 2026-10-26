# PitLane

A personal Formula 1 pit wall for timing, historical replay, telemetry, and available team radio. The app has a responsive shell and a real OpenF1 historical meeting/session catalog in Replay mode. Selecting a session does not imply replay streams are available. The circuit is an illustration, not recorded track geometry or car positions.

## Run locally

Install a stable **.NET 10 SDK** and **Node.js 24 LTS** with npm. `global.json` accepts stable .NET 10 feature bands; `.nvmrc` selects Node 24. No API keys or database are needed for the shell.

Terminal 1, from the repository root:

```sh
dotnet run --project src/PitLane.Api
```

Terminal 2:

```sh
cd src/pitlane-web
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. API listens at `http://localhost:5050`; Vite proxies `/api`. `API_PROXY_TARGET` can override that target when starting Vite. No CORS configuration is needed. Frontend-only mode works with an explicit API-unavailable status and retry action. Navigation uses shareable URL fragments and supports browser back/forward.

```sh
curl http://localhost:5050/api/health
curl http://localhost:5050/api/capabilities
curl 'http://localhost:5050/api/meetings?year=2025'
curl 'http://localhost:5050/api/meetings/1254/sessions'
```

The health endpoint checks the process, not upstream providers. Capability metadata reports implementation readiness, not session coverage. Historical catalog requests use OpenF1 and are cached in memory for 30 minutes. The catalog does not establish location, timing, telemetry, or radio availability.

### Swagger

When running with the `http` launch profile (Development), open **http://localhost:5050/swagger** to inspect and call the API. Rider's `PitLane.Api: http` profile opens Swagger automatically. The OpenAPI document is at `/swagger/v1/swagger.json`; it includes capabilities and historical catalog endpoints. `/api/health` remains an operational health endpoint outside the generated API documentation.

Swagger UI and its JSON document are enabled only in Development. The Production Docker Compose setup does not expose Swagger.

## Docker Compose

With a current Docker Desktop / Compose v2 installation running:

```sh
docker compose up --build
```

Open **http://localhost:8080**. Nginx serves the frontend and proxies `/api` to the internal backend. Only the web service is published, bound to localhost. No persistent volumes or external services are needed. Container execution must be verified on a host with a working Docker daemon.

## Checks

```sh
dotnet build PitLane.sln -c Release
dotnet format PitLane.sln --verify-no-changes --no-restore
cd src/pitlane-web
npm run lint
npm run format:check
npm run build
npm test
```

See [AGENTS.md](AGENTS.md) before development, [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), [API evaluation](docs/api-research.md), and [decisions](docs/decisions/0001-foundation.md). Replay stream coverage, live timing, telemetry, and radio remain planned.

Browser checks use installed Google Chrome via Playwright (`channel: 'chrome'`), on desktop and mobile viewports. `npm test` starts Vite if needed; capability responses are intercepted with non-race metadata to verify unavailable/retry states deterministically. The running backend is checked separately via the health/capability endpoints. No backend unit-test project exists yet; add behavioral tests with the first provider adapter.

## Rider setup

Use Rider 2025.3 or newer for full .NET 10 support. Open `PitLane.sln`.

If Rider reports `MSB3971` mentioning `.NETFramework,Version=v10.0`, check **Settings → Build, Execution, Deployment → Toolset and Build**. This was reproduced with Rider 2024.3.3 selecting Mono MSBuild 16.10.1 instead of the installed .NET SDK.

On this machine .NET SDK 10.0.403 is now installed system-wide. Set:

- **.NET CLI executable path:** `/usr/local/share/dotnet/dotnet`
- **MSBuild version:** select the .NET SDK 10.0.403 entry. If needed, use the custom path `/usr/local/share/dotnet/sdk/10.0.403/MSBuild.dll`.

Apply, reload the solution, and rebuild. These machine-specific paths are examples; use the installed SDK path on other machines. See [JetBrains toolset configuration](https://www.jetbrains.com/help/rider/Settings_Toolset_and_Build.html) and [.NET 10 support in Rider 2025.3](https://www.jetbrains.com/rider/whatsnew/2025-3/).

For the backend, choose **PitLane.Api: http** in the run selector. The Dockerfile configuration requires Docker and does not start the frontend. Run `npm run dev` in `src/pitlane-web` separately, then open `http://127.0.0.1:5173`. Backend and frontend are separate processes; the API alone has no homepage.

Unofficial personal project, not affiliated with Formula 1. External data and recordings remain subject to their providers' terms. Fonts are bundled from Fontsource (Manrope and Barlow Condensed, SIL Open Font License); package distributions contain their licenses.
