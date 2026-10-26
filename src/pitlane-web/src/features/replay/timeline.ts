import type { HistoricalLap, HistoricalPosition } from '@/lib/api'

export type SessionTimelineEvent = {
  offsetMs: number
  sequence: number
  kind: 'lap-start' | 'sector' | 'position'
  label: string
  position?: HistoricalPosition
}

export type NormalizedSessionTimeline = {
  originUtc: string
  events: SessionTimelineEvent[]
}

export function normalizeLapTimeline(
  sessionStartUtc: string,
  lap: HistoricalLap,
  positions: HistoricalPosition[],
): NormalizedSessionTimeline {
  const originMs = Date.parse(sessionStartUtc)
  const lapStartMs = lap.dateStart ? Date.parse(lap.dateStart) : originMs
  let sequence = 0
  const events: SessionTimelineEvent[] = [
    {
      offsetMs: lapStartMs - originMs,
      sequence: sequence++,
      kind: 'lap-start',
      label: `Lap ${lap.lapNumber} start`,
    },
  ]

  let sectorOffsetMs = 0
  for (const [index, duration] of [
    lap.sector1Duration,
    lap.sector2Duration,
    lap.sector3Duration,
  ].entries()) {
    if (duration === null) break
    if (index === 0) sectorOffsetMs = Math.round(duration * 1000)
    else sectorOffsetMs += Math.round(duration * 1000)
    if (index < 2) {
      events.push({
        offsetMs: lapStartMs + sectorOffsetMs - originMs,
        sequence: sequence++,
        kind: 'sector',
        label: `Sector ${index + 1} complete`,
      })
    }
  }

  for (const position of positions) {
    const dateMs = Date.parse(position.date)
    if (!Number.isFinite(dateMs)) continue
    events.push({
      offsetMs: dateMs - originMs,
      sequence: sequence++,
      kind: 'position',
      label: 'Position sample',
      position,
    })
  }

  events.sort(
    (left, right) =>
      left.offsetMs - right.offsetMs || left.sequence - right.sequence,
  )
  return { originUtc: new Date(originMs).toISOString(), events }
}
