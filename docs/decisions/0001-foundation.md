# ADR 0001: Small local foundation, replay first

Status: Accepted, 2026-10-26.

Use a React/TypeScript Vite frontend and one .NET 10 minimal API project. Keep the API and frontend deployable independently, with same-origin proxying. Keep dependencies current and lock the frontend resolution. Use source-owned shadcn-style Radix button/dialog primitives, Tailwind tokens, and Motion with reduced-motion support.

Build replay before live, sharing normalized session data and visualization components. Prefer OpenF1 for the first historical session integration; use Jolpica for deeper calendar/results history when needed. FastF1 is an optional future import tool, not a required runtime service. Do not add PostgreSQL, EF Core, Zustand, ECharts, or SignalR until actual behavior calls for them.

The initial shell contains no external race integration. Empty states and disabled playback communicate availability. A schematic circuit establishes the workspace composition and is labeled as illustrative. This allows visual work without misleading users about real data.

Consequence: useful navigation and operational health can be validated now, but no claim about replay correctness or provider availability is possible yet.
