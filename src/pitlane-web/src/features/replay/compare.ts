import type { HistoricalLap, HistoricalPitStop } from '../../lib/api.js'
import { trackStatusAt, type RaceControlEvent } from './replay-engine.js'

export type Sectors = [number | null, number | null, number | null]

export type CompareRow = {
  lap: number
  a: number | null
  b: number | null
  /** a - b in seconds; negative means driver A was quicker. */
  delta: number | null
  aSectors: Sectors
  bSectors: Sectors
  /** Time gap at the end of the lap, A behind B is positive. */
  gap: number | null
  pitA: boolean
  pitB: boolean
  /** Safety car or VSC was out at some point on this lap. */
  neutralised: 'sc' | 'vsc' | null
}

type LapEnd = { lap: HistoricalLap; endMs: number; startMs: number }

function finishedLaps(laps: HistoricalLap[], driverNumber: number) {
  const byLap = new Map<number, LapEnd>()
  for (const lap of laps) {
    if (lap.driverNumber !== driverNumber || !lap.dateStart) continue
    const startMs = Date.parse(lap.dateStart)
    if (!Number.isFinite(startMs)) continue
    const endMs =
      lap.lapDuration != null && lap.lapDuration > 0
        ? startMs + lap.lapDuration * 1_000
        : NaN
    byLap.set(lap.lapNumber, { lap, startMs, endMs })
  }
  return byLap
}

/** Laps with a recorded stop; the pit-out flag is only a fallback. */
function pitLaps(pitStops: HistoricalPitStop[], driverNumber: number) {
  const laps = new Set<number>()
  for (const stop of pitStops)
    if (stop.driverNumber === driverNumber && stop.lapNumber != null)
      laps.add(stop.lapNumber)
  return laps
}

function sectors(lap: HistoricalLap | undefined): Sectors {
  return [
    lap?.sector1Duration ?? null,
    lap?.sector2Duration ?? null,
    lap?.sector3Duration ?? null,
  ]
}

function neutralisedDuring(
  events: RaceControlEvent[],
  startMs: number,
  endMs: number,
): CompareRow['neutralised'] {
  if (!events.length || !Number.isFinite(startMs)) return null
  // Check the state at the lap start and at every safety-car message inside
  // the lap, so a short VSC between two samples is not missed.
  const checkpoints = [startMs]
  for (const { timeMs, message } of events)
    if (message.category === 'SafetyCar' && timeMs > startMs && timeMs < endMs)
      checkpoints.push(timeMs)
  let result: CompareRow['neutralised'] = null
  for (const timeMs of checkpoints) {
    const state = trackStatusAt(events, timeMs).safetyCar
    if (state === 'SC' || state === 'SC ENDING') return 'sc'
    if (state === 'VSC' || state === 'VSC ENDING') result = 'vsc'
  }
  return result
}

/**
 * Lap-by-lap comparison of two drivers, using only laps both finished before
 * the playhead so the view never reveals the future.
 */
export function compareDrivers({
  laps,
  pitStops,
  events,
  a,
  b,
  untilMs,
}: {
  laps: HistoricalLap[]
  pitStops: HistoricalPitStop[]
  events: RaceControlEvent[]
  a: number
  b: number
  untilMs: number
}): CompareRow[] {
  const lapsA = finishedLaps(laps, a)
  const lapsB = finishedLaps(laps, b)
  const pitsA = pitLaps(pitStops, a)
  const pitsB = pitLaps(pitStops, b)
  const numbers = [...new Set([...lapsA.keys(), ...lapsB.keys()])].sort(
    (x, y) => x - y,
  )
  const rows: CompareRow[] = []
  for (const lap of numbers) {
    const endA = lapsA.get(lap)
    const endB = lapsB.get(lap)
    const doneA = endA && endA.endMs <= untilMs ? endA : undefined
    const doneB = endB && endB.endMs <= untilMs ? endB : undefined
    if (!doneA && !doneB) continue
    const timeA = doneA?.lap.lapDuration ?? null
    const timeB = doneB?.lap.lapDuration ?? null
    const reference = doneA ?? doneB!
    rows.push({
      lap,
      a: timeA,
      b: timeB,
      delta: timeA !== null && timeB !== null ? timeA - timeB : null,
      aSectors: sectors(doneA?.lap),
      bSectors: sectors(doneB?.lap),
      gap:
        doneA && doneB && Number.isFinite(doneA.endMs - doneB.endMs)
          ? (doneA.endMs - doneB.endMs) / 1_000
          : null,
      pitA: pitsA.size
        ? pitsA.has(lap)
        : Boolean(lapsA.get(lap + 1)?.lap.isPitOutLap),
      pitB: pitsB.size
        ? pitsB.has(lap)
        : Boolean(lapsB.get(lap + 1)?.lap.isPitOutLap),
      neutralised: neutralisedDuring(
        events,
        reference.startMs,
        reference.endMs,
      ),
    })
  }
  return rows
}

/** Best of each sector across the given rows, per driver. */
export function bestSectors(rows: CompareRow[], driver: 'a' | 'b'): Sectors {
  const best: Sectors = [null, null, null]
  for (const row of rows) {
    const values = driver === 'a' ? row.aSectors : row.bSectors
    values.forEach((value, index) => {
      if (
        value != null &&
        value > 0 &&
        (best[index] == null || value < best[index]!)
      )
        best[index] = value
    })
  }
  return best
}
