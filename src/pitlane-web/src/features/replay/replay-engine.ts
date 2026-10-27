import type {
  HistoricalCarSample,
  HistoricalLap,
  HistoricalPitStop,
  HistoricalPosition,
  HistoricalSessionResult,
  HistoricalStint,
} from '../../lib/api.js'

export type PlaybackSnapshot = {
  elapsedMs: number
  timestampMs: number
  isPlaying: boolean
  speed: number
}

export type FrameScheduler = {
  request: (callback: (now: number) => void) => number
  cancel: (id: number) => void
  now: () => number
}

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
}

export class ReplayClock {
  private elapsedMs = 0
  private speed = 1
  private playing = false
  private frameId: number | null = null
  private previousFrameMs = 0
  private listeners = new Set<(snapshot: PlaybackSnapshot) => void>()
  private readonly startMs: number
  private readonly durationMs: number
  private readonly frames: FrameScheduler

  constructor(
    startMs: number,
    durationMs: number,
    frames: FrameScheduler = browserFrames,
  ) {
    this.startMs = startMs
    this.durationMs = durationMs
    this.frames = frames
  }

  getSnapshot(): PlaybackSnapshot {
    return {
      elapsedMs: this.elapsedMs,
      timestampMs: this.startMs + this.elapsedMs,
      isPlaying: this.playing,
      speed: this.speed,
    }
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  seek(elapsedMs: number) {
    this.elapsedMs = Math.max(0, Math.min(elapsedMs, this.durationMs))
    this.emit()
    if (this.elapsedMs >= this.durationMs) this.pause()
  }

  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed <= 0) return
    this.speed = speed
    this.emit()
  }

  play() {
    if (this.playing || this.durationMs <= 0) return
    if (this.elapsedMs >= this.durationMs) this.elapsedMs = 0
    this.playing = true
    this.previousFrameMs = this.frames.now()
    this.emit()
    this.frameId = this.frames.request(this.tick)
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    if (this.frameId !== null) this.frames.cancel(this.frameId)
    this.frameId = null
    this.emit()
  }

  dispose() {
    if (this.frameId !== null) this.frames.cancel(this.frameId)
    this.frameId = null
    this.playing = false
    this.listeners.clear()
  }

  private readonly tick = (now: number) => {
    if (!this.playing) return
    this.elapsedMs = Math.min(
      this.durationMs,
      this.elapsedMs + (now - this.previousFrameMs) * this.speed,
    )
    this.previousFrameMs = now
    this.emit()
    if (this.elapsedMs >= this.durationMs) {
      this.playing = false
      this.frameId = null
      this.emit()
      return
    }
    this.frameId = this.frames.request(this.tick)
  }

  private emit() {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export function normalizePositions(samples: HistoricalPosition[]) {
  return samples
    .map((sample, index) => ({
      sample,
      index,
      dateMs: Date.parse(sample.date),
    }))
    .filter(({ dateMs }) => Number.isFinite(dateMs))
    .sort((a, b) => a.dateMs - b.dateMs || a.index - b.index)
    .filter(
      (entry, index, entries) =>
        index === entries.length - 1 ||
        entry.dateMs !== entries[index + 1].dateMs ||
        entry.sample.driverNumber !== entries[index + 1].sample.driverNumber,
    )
    .map(({ sample }) => sample)
}

export function removeSharedStationaryPositions(
  samples: HistoricalPosition[],
): HistoricalPosition[] {
  const normalized = normalizePositions(samples)
  const coordinateCounts = new Map<
    string,
    {
      drivers: Set<number>
      rowsPerDriver: Map<number, number>
      firstMs: number
      lastMs: number
    }
  >()
  for (const sample of normalized) {
    if (
      sample.x === null ||
      sample.y === null ||
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y)
    )
      continue
    const key = `${sample.x},${sample.y}`
    const dateMs = Date.parse(sample.date)
    const count = coordinateCounts.get(key) ?? {
      drivers: new Set<number>(),
      rowsPerDriver: new Map<number, number>(),
      firstMs: dateMs,
      lastMs: dateMs,
    }
    count.drivers.add(sample.driverNumber)
    count.rowsPerDriver.set(
      sample.driverNumber,
      (count.rowsPerDriver.get(sample.driverNumber) ?? 0) + 1,
    )
    count.firstMs = Math.min(count.firstMs, dateMs)
    count.lastMs = Math.max(count.lastMs, dateMs)
    coordinateCounts.set(key, count)
  }

  const sharedStationaryCoordinates = new Set<string>()
  for (const [key, count] of coordinateCounts) {
    if (
      count.drivers.size >= 4 &&
      [...count.rowsPerDriver.values()].filter((rows) => rows >= 3).length >=
        4 &&
      count.lastMs - count.firstMs >= 5_000
    )
      sharedStationaryCoordinates.add(key)
  }

  return normalized.filter(
    (sample) =>
      sample.x === null ||
      sample.y === null ||
      !sharedStationaryCoordinates.has(`${sample.x},${sample.y}`),
  )
}

export type ReplayPoint = {
  x: number
  y: number
  dateMs: number
  segment?: number
}

function positionTangent(
  previous: ReplayPoint | undefined,
  current: ReplayPoint,
  next: ReplayPoint | undefined,
  coordinate: 'x' | 'y',
  maxGapMs: number,
) {
  const nextGap = next ? next.dateMs - current.dateMs : 0
  const previousGap = previous ? current.dateMs - previous.dateMs : 0
  const nextSlope =
    next && nextGap > 0 && nextGap <= maxGapMs
      ? (next[coordinate] - current[coordinate]) / nextGap
      : undefined
  const previousSlope =
    previous && previousGap > 0 && previousGap <= maxGapMs
      ? (current[coordinate] - previous[coordinate]) / previousGap
      : undefined

  if (nextSlope === undefined) return previousSlope ?? 0
  if (previousSlope === undefined) return nextSlope
  if (
    nextSlope === 0 ||
    previousSlope === 0 ||
    Math.sign(nextSlope) !== Math.sign(previousSlope)
  )
    return 0

  // Shape-preserving harmonic mean: smooths sample cadence changes without
  // overshooting the recorded positions or introducing a trailing filter.
  const weightPrevious = 2 * nextGap + previousGap
  const weightNext = nextGap + 2 * previousGap
  return (
    (weightPrevious + weightNext) /
    (weightPrevious / previousSlope + weightNext / nextSlope)
  )
}

export function interpolatePosition(
  points: ReplayPoint[],
  dateMs: number,
  maxGapMs = 1_500,
): Omit<ReplayPoint, 'dateMs'> | null {
  let low = 0
  let high = points.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (points[mid].dateMs < dateMs) low = mid + 1
    else high = mid
  }
  const right = points[low]
  const left = points[low - 1]
  if (right?.dateMs === dateMs) return { x: right.x, y: right.y }
  if (!left || !right) return null
  const gap = right.dateMs - left.dateMs
  if (
    gap <= 0 ||
    gap > maxGapMs ||
    (left.segment !== undefined &&
      right.segment !== undefined &&
      left.segment !== right.segment)
  )
    return null
  const fraction = (dateMs - left.dateMs) / gap
  if (fraction < 0 || fraction > 1) return null
  const previous = points[low - 2]
  const next = points[low + 1]
  const validNeighbor = (
    point: ReplayPoint | undefined,
    adjacent: ReplayPoint,
  ) =>
    point &&
    adjacent.dateMs - point.dateMs <= maxGapMs &&
    (point.segment === undefined ||
      adjacent.segment === undefined ||
      point.segment === adjacent.segment)
      ? point
      : undefined
  const beforeLeft = validNeighbor(previous, left)
  const afterRight = validNeighbor(next, right)
  const h00 = 2 * fraction ** 3 - 3 * fraction ** 2 + 1
  const h10 = fraction ** 3 - 2 * fraction ** 2 + fraction
  const h01 = -2 * fraction ** 3 + 3 * fraction ** 2
  const h11 = fraction ** 3 - fraction ** 2
  const interpolate = (coordinate: 'x' | 'y') => {
    const startTangent = positionTangent(
      beforeLeft,
      left,
      right,
      coordinate,
      maxGapMs,
    )
    const endTangent = positionTangent(
      left,
      right,
      afterRight,
      coordinate,
      maxGapMs,
    )
    return (
      h00 * left[coordinate] +
      h10 * gap * startTangent +
      h01 * right[coordinate] +
      h11 * gap * endTangent
    )
  }
  return {
    x: interpolate('x'),
    y: interpolate('y'),
  }
}

export function normalizeCarSamples(samples: HistoricalCarSample[]) {
  return samples
    .map((sample, index) => ({
      sample,
      index,
      dateMs: Date.parse(sample.date),
    }))
    .filter(({ dateMs }) => Number.isFinite(dateMs))
    .sort((a, b) => a.dateMs - b.dateMs || a.index - b.index)
    .filter(
      (entry, index, entries) =>
        index === entries.length - 1 ||
        entry.dateMs !== entries[index + 1].dateMs,
    )
    .map(({ sample }) => sample)
}

export function telemetryAt(
  samples: HistoricalCarSample[],
  timestampMs: number,
  maxGapMs = 3_000,
): HistoricalCarSample | null {
  let low = 0
  let high = samples.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (Date.parse(samples[mid].date) < timestampMs) low = mid + 1
    else high = mid
  }
  const right = samples[low]
  const left = samples[low - 1]
  if (right && Date.parse(right.date) === timestampMs) return right
  if (!left) return null
  const leftMs = Date.parse(left.date)
  const rightMs = right ? Date.parse(right.date) : NaN
  if (!right) return timestampMs - leftMs <= maxGapMs ? left : null
  const gap = rightMs - leftMs
  if (gap <= 0 || gap > maxGapMs) return null
  const fraction = (timestampMs - leftMs) / gap
  const numeric = (key: 'speed' | 'rpm' | 'throttle') => {
    const from = left[key]
    const to = right[key]
    return from === null || to === null ? null : from + (to - from) * fraction
  }
  return {
    ...left,
    speed: numeric('speed'),
    rpm: numeric('rpm'),
    throttle: numeric('throttle'),
    // Gear, brake, and DRS are discrete: retain the last state at this time.
  }
}

export function lapAt(
  laps: HistoricalLap[],
  driverNumber: number,
  timestampMs: number,
): HistoricalLap | null {
  let low = 0
  let high = laps.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const lap = laps[mid]
    const dateMs = lap.dateStart ? Date.parse(lap.dateStart) : Infinity
    if (
      lap.driverNumber < driverNumber ||
      (lap.driverNumber === driverNumber && dateMs <= timestampMs)
    )
      low = mid + 1
    else high = mid
  }
  const candidate = laps[low - 1]
  return candidate?.driverNumber === driverNumber ? candidate : null
}

export function stintAt(
  stints: HistoricalStint[],
  driverNumber: number,
  lapNumber: number | null,
): HistoricalStint | null {
  if (lapNumber === null) return null
  let match: HistoricalStint | null = null
  for (const stint of stints) {
    if (stint.driverNumber > driverNumber) break
    if (
      stint.driverNumber === driverNumber &&
      stint.lapStart !== null &&
      stint.lapStart <= lapNumber &&
      (stint.lapEnd === null || lapNumber <= stint.lapEnd) &&
      (!match || stint.stintNumber > match.stintNumber)
    )
      match = stint
  }
  return match
}

export function tyreAtReplayTime(
  stints: HistoricalStint[],
  laps: HistoricalLap[],
  driverNumber: number,
  timestampMs: number,
  result?: HistoricalSessionResult,
): {
  stint: HistoricalStint | null
  certainty: 'at-playhead' | 'last-reported' | 'starting' | 'unavailable'
} {
  const lap = lapAt(laps, driverNumber, timestampMs)
  if (lap) {
    const stint = stintAt(stints, driverNumber, lap.lapNumber)
    return {
      stint,
      certainty: stint ? 'at-playhead' : 'unavailable',
    }
  }

  const driverStints = stints.filter(
    (stint) => stint.driverNumber === driverNumber,
  )
  if (!driverStints.length) return { stint: null, certainty: 'unavailable' }
  const orderedStints = [...driverStints].sort(
    (a, b) => a.stintNumber - b.stintNumber,
  )
  const firstLapDate = laps
    .filter((item) => item.driverNumber === driverNumber && item.dateStart)
    .map((item) => Date.parse(item.dateStart!))
    .filter(Number.isFinite)
    .reduce((minimum, dateMs) => Math.min(minimum, dateMs), Infinity)

  if (
    Number.isFinite(firstLapDate) &&
    timestampMs < firstLapDate &&
    orderedStints[0].lapStart === 1
  ) {
    return { stint: orderedStints[0], certainty: 'starting' }
  }
  if (result?.dns) {
    return { stint: orderedStints[0], certainty: 'last-reported' }
  }
  if (result?.dnf || result?.dsq) {
    return {
      stint: orderedStints[orderedStints.length - 1],
      certainty: 'last-reported',
    }
  }
  return { stint: null, certainty: 'unavailable' }
}

export type DriverTrackStatus = 'ON TRACK' | 'PIT LANE' | 'NO DATA'

/**
 * OpenF1's pit `date` is treated as the recorded end of the lane visit and
 * laneDuration as its elapsed duration. The API documents both fields but
 * not the timestamp boundary; this direction matches observed race samples.
 */
export function pitStopVisitAt(
  driverNumber: number,
  timestampMs: number,
  pitStops: HistoricalPitStop[],
): HistoricalPitStop | null {
  for (const stop of pitStops) {
    if (stop.driverNumber !== driverNumber) continue
    const endMs = Date.parse(stop.date)
    const durationMs =
      stop.laneDuration === null ? NaN : stop.laneDuration * 1_000
    if (
      Number.isFinite(endMs) &&
      Number.isFinite(durationMs) &&
      durationMs > 0 &&
      timestampMs >= endMs - durationMs &&
      timestampMs < endMs
    )
      return stop
  }
  return null
}

export function driverTrackStatusAt(
  driverNumber: number,
  timestampMs: number,
  positions: HistoricalPosition[],
  pitStops: HistoricalPitStop[],
  maxPositionAgeMs = 2_000,
): DriverTrackStatus {
  if (pitStopVisitAt(driverNumber, timestampMs, pitStops)) return 'PIT LANE'

  let low = 0
  let high = positions.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const sample = positions[mid]
    if (
      sample.driverNumber < driverNumber ||
      (sample.driverNumber === driverNumber &&
        Date.parse(sample.date) <= timestampMs)
    )
      low = mid + 1
    else high = mid
  }
  const latest = positions[low - 1]
  if (
    latest?.driverNumber === driverNumber &&
    timestampMs - Date.parse(latest.date) <= maxPositionAgeMs &&
    latest.x !== null &&
    latest.y !== null
  )
    return 'ON TRACK'
  return 'NO DATA'
}

export function replayStatusAt(
  driverNumber: number,
  timestampMs: number,
  positions: HistoricalPosition[],
  pitStops: HistoricalPitStop[],
  result?: HistoricalSessionResult,
): DriverTrackStatus | 'DNS' | 'DNF' | 'DSQ' {
  if (result?.dsq) return 'DSQ'
  if (result?.dns) return 'DNS'
  if (result?.dnf) return 'DNF'
  return driverTrackStatusAt(driverNumber, timestampMs, positions, pitStops)
}

export function finalResultStatus(
  result?: HistoricalSessionResult,
): string | null {
  if (!result) return null
  if (result.dsq) return 'DSQ'
  if (result.dns) return 'DNS'
  if (result.dnf) return 'DNF'
  return null
}

export type LabelTarget = {
  driverNumber: number
  acronym: string
  x: number
  y: number
  selected: boolean
}

export type LabelPlacement = {
  driverNumber: number
  x: number
  y: number
  markerX: number
  markerY: number
  leader: boolean
}

type LabelRect = { left: number; top: number; right: number; bottom: number }
const labelOffsetCache = new Map<number, [number, number][]>()

function offsetsForLabelWidth(labelWidth: number) {
  const cached = labelOffsetCache.get(labelWidth)
  if (cached) return cached
  const offsets: [number, number][] = []
  for (const radius of [12, 30, 48, 66, 84, 102, 120, 138, 156, 174, 192]) {
    for (let direction = 0; direction < 16; direction++) {
      const angle = (direction / 16) * Math.PI * 2
      offsets.push([
        Math.cos(angle) * radius - labelWidth / 2,
        Math.sin(angle) * radius - 9,
      ])
    }
  }
  labelOffsetCache.set(labelWidth, offsets)
  return offsets
}

function overlaps(a: LabelRect, b: LabelRect) {
  return (
    a.left < b.right + 3 &&
    a.right + 3 > b.left &&
    a.top < b.bottom + 3 &&
    a.bottom + 3 > b.top
  )
}

function materiallyOverlaps(a: LabelRect, b: LabelRect) {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlapX > 8 && overlapY > 6
}

export function placeDriverLabels(
  targets: LabelTarget[],
  width = 500,
  height = 350,
  previous = new Map<number, { dx: number; dy: number }>(),
): LabelPlacement[] {
  const placed: LabelRect[] = []
  const result: LabelPlacement[] = []
  const ordered = [...targets].sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      a.driverNumber - b.driverNumber,
  )
  for (const target of ordered) {
    const labelWidth = Math.max(30, target.acronym.length * 7 + 10)
    const labelHeight = 18
    const candidates = offsetsForLabelWidth(labelWidth)
    const remembered = previous.get(target.driverNumber)
    let choice: { dx: number; dy: number; rect: LabelRect } | null = null
    if (remembered) {
      const rect = {
        left: target.x + remembered.dx,
        top: target.y + remembered.dy,
        right: target.x + remembered.dx + labelWidth,
        bottom: target.y + remembered.dy + labelHeight,
      }
      if (
        rect.left >= 2 &&
        rect.top >= 2 &&
        rect.right <= width - 2 &&
        rect.bottom <= height - 2 &&
        placed.every((other) => !materiallyOverlaps(rect, other))
      )
        choice = { ...remembered, rect }
    }
    if (!choice)
      for (const [dx, dy] of candidates) {
        const rect = {
          left: target.x + dx,
          top: target.y + dy,
          right: target.x + dx + labelWidth,
          bottom: target.y + dy + labelHeight,
        }
        if (
          rect.left < 2 ||
          rect.top < 2 ||
          rect.right > width - 2 ||
          rect.bottom > height - 2 ||
          placed.some((other) => overlaps(rect, other))
        )
          continue
        choice = { dx, dy, rect }
        break
      }
    if (!choice) continue
    placed.push(choice.rect)
    result.push({
      driverNumber: target.driverNumber,
      x: choice.rect.left,
      y: choice.rect.top + 15,
      markerX: target.x,
      markerY: target.y,
      leader: Math.hypot(choice.dx, choice.dy) > 24,
    })
  }
  return result
}
