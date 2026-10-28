// Trace circuit outlines from recorded OpenF1 positions via a running PitLane API (default :5051).
// Usage: ONLY="Monza,Suzuka" node scripts/trace-circuit-outlines.mjs src/features/replay/circuit-outlines.json
// Usage: ONLY="Monza,Suzuka" node scripts/trace-circuit-outlines.mjs src/features/replay/circuit-outlines.json
import fs from 'node:fs'
const API = process.env.API ?? 'http://localhost:5051'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(path) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(API + path)
    if (r.ok) {
      await sleep(700)
      return r.json()
    }
    await sleep(3000 * (i + 1))
  }
  throw new Error('failed ' + path)
}
const now = Date.now()
const latest = new Map()
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
const all = []
for (const year of [2023, 2024, 2025, 2026]) {
  for (const m of (await get(`/api/meetings?year=${year}`)).items) {
    if (m.isCancelled || Date.parse(m.dateEnd) > now) continue
    const testing = /testing/i.test(m.meetingName)
    if (!testing && (!ONLY.length || ONLY.includes(m.circuitShortName)))
      all.push(m)
    const prev = latest.get(m.circuitShortName)
    if (
      !prev ||
      (prev.testing && !testing) ||
      (!testing && Date.parse(m.dateStart) > Date.parse(prev.m.dateStart))
    )
      latest.set(m.circuitShortName, { m, testing })
  }
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts.at(-1)]
  let max = 0,
    idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i],
      dx = b[0] - a[0],
      dy = b[1] - a[1]
    const d =
      Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) /
      (Math.hypot(dx, dy) || 1)
    if (d > max) {
      max = d
      idx = i
    }
  }
  return max > eps
    ? [
        ...rdp(pts.slice(0, idx + 1), eps).slice(0, -1),
        ...rdp(pts.slice(idx), eps),
      ]
    : [a, b]
}
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const name of ONLY) {
  for (const m of all.filter((x) => x.circuitShortName === name).reverse()) {
    if (out[name] && out[name].length > 300) break
    for (const offset of [30, 50, 70]) {
      if (out[name] && out[name].length > 300) break
      try {
        const sessions = (await get(`/api/meetings/${m.meetingKey}/sessions`))
          .items
        const s =
          sessions.findLast((x) => x.sessionName === 'Race') ?? sessions.at(-1)
        const drivers = (await get(`/api/sessions/${s.sessionKey}/drivers`))
          .items
        let lap = null
        for (const d of drivers.slice(0, 4)) {
          const from = new Date(
            Date.parse(s.dateStart) + offset * 60_000,
          ).toISOString()
          const to = new Date(
            Date.parse(s.dateStart) + (offset + 3) * 60_000,
          ).toISOString()
          const pos = (
            await get(
              `/api/sessions/${s.sessionKey}/positions?driverNumber=${d.driverNumber}&fromUtc=${from}&toUtc=${to}`,
            )
          ).items
            .filter(
              (p) => p.x != null && p.y != null && !(p.x === 0 && p.y === 0),
            )
            .map((p) => ({ t: Date.parse(p.date), x: p.x, y: p.y }))
          if (pos.length < 150) continue
          const p0 = pos[0]
          let best = -1,
            bestD = Infinity
          for (let i = 1; i < pos.length; i++) {
            if (pos[i].t - p0.t < 50_000) continue
            const d2 = Math.hypot(pos[i].x - p0.x, pos[i].y - p0.y)
            if (d2 < bestD) {
              bestD = d2
              best = i
            }
            if (pos[i].t - p0.t > 150_000) break
          }
          if (best < 0 || bestD > 400 || best < 60) continue
          const span =
            Math.max(...pos.map((p) => p.x)) - Math.min(...pos.map((p) => p.x))
          if (span < 1500) continue
          lap = pos.slice(0, best + 1)
          break
        }
        if (!lap) {
          console.log('skip', name, m.year, offset)
          continue
        }
        const xs = lap.map((p) => p.x),
          ys = lap.map((p) => p.y)
        const minX = Math.min(...xs),
          minY = Math.min(...ys),
          w = Math.max(...xs) - minX,
          h = Math.max(...ys) - minY
        const k = 100 / Math.max(w, h)
        const ox = (100 - w * k) / 2,
          oy = (100 - h * k) / 2
        const pts = rdp(
          lap.map((p) => [ox + (p.x - minX) * k, oy + (h - (p.y - minY)) * k]),
          0.35,
        )
        out[name] =
          'M' +
          pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') +
          'Z'
        console.log('ok', name, pts.length, 'from', m.meetingName, m.year)
      } catch (e) {
        console.log('err', name, e.message)
        await sleep(5000)
      }
    }
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n')
