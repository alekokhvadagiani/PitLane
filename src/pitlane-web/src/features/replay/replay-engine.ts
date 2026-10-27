import type {
  HistoricalCarSample,
  HistoricalInterval,
  HistoricalLap,
  HistoricalPitStop,
  HistoricalPosition,
  HistoricalRaceControlMessage,
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
  // Time-weighted central difference (Catmull-Rom style). Samples are
  // retimed first (see retimeAlongPath), so the cadence is even and this
  // keeps speed continuous through corners instead of easing to zero
  // whenever one axis changes direction.
  return (
    (nextSlope * previousGap + previousSlope * nextGap) /
    (previousGap + nextGap)
  )
}

const RETIME_WINDOW = 3
const RETIME_MAX_SHIFT_MS = 250

/**
 * OpenF1 location timestamps jitter by roughly ±0.1 s, so linear motion
 * between raw samples alternates fast and slow. Each point keeps its
 * recorded position; only its time is re-estimated from a local linear fit
 * of time against distance travelled (±3 samples, same segment), capped at
 * 250 ms. Near-stationary stretches keep their recorded times.
 */
export function retimeAlongPath(points: ReplayPoint[]): ReplayPoint[] {
  if (points.length < 3) return points
  const distance: number[] = [0]
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const current = points[index]
    distance.push(
      distance[index - 1] +
        (previous.segment === current.segment
          ? Math.hypot(current.x - previous.x, current.y - previous.y)
          : 0),
    )
  }
  const result: ReplayPoint[] = []
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    let from = index
    let to = index
    while (
      from > 0 &&
      index - from < RETIME_WINDOW &&
      points[from - 1].segment === point.segment
    )
      from--
    while (
      to < points.length - 1 &&
      to - index < RETIME_WINDOW &&
      points[to + 1].segment === point.segment
    )
      to++
    let dateMs = point.dateMs
    const count = to - from + 1
    if (count >= 3 && distance[to] - distance[from] >= 3) {
      let meanS = 0
      let meanT = 0
      for (let j = from; j <= to; j++) {
        meanS += distance[j]
        meanT += points[j].dateMs
      }
      meanS /= count
      meanT /= count
      let covariance = 0
      let variance = 0
      for (let j = from; j <= to; j++) {
        covariance += (distance[j] - meanS) * (points[j].dateMs - meanT)
        variance += (distance[j] - meanS) ** 2
      }
      if (variance > 0) {
        const fitted =
          meanT + (covariance / variance) * (distance[index] - meanS)
        dateMs = Math.max(
          point.dateMs - RETIME_MAX_SHIFT_MS,
          Math.min(point.dateMs + RETIME_MAX_SHIFT_MS, fitted),
        )
      }
    }
    const previous = result[result.length - 1]
    if (previous && dateMs <= previous.dateMs) dateMs = previous.dateMs + 1
    result.push({ ...point, dateMs })
  }
  return result
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
  if (result?.dns) return 'DNS'
  // DNF/DSQ are final results without a timestamp. While the car still has
  // recorded positions it was racing, so the playhead status wins.
  const trackStatus = driverTrackStatusAt(
    driverNumber,
    timestampMs,
    positions,
    pitStops,
  )
  if (trackStatus !== 'NO DATA') return trackStatus
  if (result?.dsq) return 'DSQ'
  if (result?.dnf) return 'DNF'
  return trackStatus
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

export type MapSize = { width: number; height: number }

export type TrackProjection = {
  project: (x: number, y: number) => { x: number; y: number }
}

/**
 * Fits OpenF1 local X/Y into a map of the given size without distortion.
 * World Y points up; screen Y points down. If turning the circuit a quarter
 * turn makes it larger in this frame, it is rotated (never mirrored).
 */
export function createTrackProjection(
  samples: HistoricalPosition[],
  size: MapSize,
  padding = 36,
): TrackProjection | null {
  const rows = removeSharedStationaryPositions(samples).filter(
    (row) =>
      row.x !== null &&
      row.y !== null &&
      Number.isFinite(row.x) &&
      Number.isFinite(row.y),
  )
  if (rows.length < 2) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const row of rows) {
    minX = Math.min(minX, row.x!)
    maxX = Math.max(maxX, row.x!)
    minY = Math.min(minY, row.y!)
    maxY = Math.max(maxY, row.y!)
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const usableWidth = Math.max(size.width - padding * 2, 1)
  const usableHeight = Math.max(size.height - padding * 2, 1)
  // Orientation depends on the circuit only, never on the panel, so resizing
  // or entering full screen can't turn the track. Tall circuits are laid on
  // their side; the margin keeps near-square ones upright.
  const rotate = spanY > spanX * 1.08
  const scale = rotate
    ? Math.min(usableWidth / spanY, usableHeight / spanX)
    : Math.min(usableWidth / spanX, usableHeight / spanY)
  const drawnWidth = (rotate ? spanY : spanX) * scale
  const drawnHeight = (rotate ? spanX : spanY) * scale
  const offsetX = (size.width - drawnWidth) / 2
  const offsetY = (size.height - drawnHeight) / 2
  return {
    project: (x, y) =>
      rotate
        ? // Quarter turn clockwise: world east points down, world north
          // points right. Keeps handedness, unlike swapping X and Y.
          {
            x: offsetX + (y - minY) * scale,
            y: offsetY + (x - minX) * scale,
          }
        : {
            x: offsetX + (x - minX) * scale,
            y: offsetY + (maxY - y) * scale,
          },
  }
}

export type AeroAidState = 'enabled' | 'disabled' | 'unknown'
export type AeroAidChange = { timeMs: number; enabled: boolean }

/**
 * Session-wide enable/disable notices from race control, for DRS (to 2025)
 * or Overtake Mode (2026+). Returns changes sorted by time. These say whether
 * the aid was allowed, not whether a given car used it.
 */
export function aeroAidChanges(
  messages: HistoricalRaceControlMessage[],
  aid: 'DRS' | 'OVERTAKE',
): AeroAidChange[] {
  const pattern = new RegExp(`\\b${aid}(?: MODE)? (ENABLED|DISABLED)\\b`, 'i')
  const changes: AeroAidChange[] = []
  for (const message of messages) {
    const match = pattern.exec(message.message)
    const timeMs = Date.parse(message.date)
    if (!match || !Number.isFinite(timeMs)) continue
    changes.push({ timeMs, enabled: match[1].toUpperCase() === 'ENABLED' })
  }
  return changes.sort((a, b) => a.timeMs - b.timeMs)
}

export function aeroAidStateAt(
  changes: AeroAidChange[],
  timestampMs: number,
): AeroAidState {
  let low = 0
  let high = changes.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (changes[mid].timeMs <= timestampMs) low = mid + 1
    else high = mid
  }
  const latest = changes[low - 1]
  return latest ? (latest.enabled ? 'enabled' : 'disabled') : 'unknown'
}

export type SectorFlag = 'YELLOW' | 'DOUBLE YELLOW'
export type SafetyCarState = 'SC' | 'SC ENDING' | 'VSC' | 'VSC ENDING' | null
export type TrackStatus = {
  /** Most severe condition: drives the map tint. */
  level: 'green' | 'yellow' | 'double-yellow' | 'vsc' | 'sc' | 'red'
  /** Marshal sectors under yellow, ascending. */
  sectors: { sector: number; flag: SectorFlag }[]
  safetyCar: SafetyCarState
  red: boolean
}

export type RaceControlEvent = {
  timeMs: number
  message: HistoricalRaceControlMessage
}

/** Messages that affect track status, parsed once and sorted by time. */
export function trackStatusEvents(
  messages: HistoricalRaceControlMessage[],
): RaceControlEvent[] {
  return messages
    .map((message) => ({ timeMs: Date.parse(message.date), message }))
    .filter(
      ({ timeMs, message }) =>
        Number.isFinite(timeMs) &&
        (message.category === 'Flag' || message.category === 'SafetyCar'),
    )
    .sort((a, b) => a.timeMs - b.timeMs)
}

function messageSector(message: HistoricalRaceControlMessage) {
  if (message.sector != null && message.sector > 0) return message.sector
  const match = /SECTOR (\d+)/i.exec(message.message)
  return match ? Number(match[1]) : null
}

/**
 * Replays race control up to the playhead. Sector yellows stay until that
 * sector is cleared or the whole track goes green/clear. SC/VSC follow the
 * deploy / ending notices and end at the next track-wide green.
 */
export function trackStatusAt(
  events: RaceControlEvent[],
  timestampMs: number,
): TrackStatus {
  const sectors = new Map<number, SectorFlag>()
  let safetyCar: SafetyCarState = null
  let red = false
  for (const { timeMs, message } of events) {
    if (timeMs > timestampMs) break
    const flag = message.flag?.toUpperCase() ?? ''
    const scope = message.scope?.toUpperCase() ?? ''
    const text = message.message.toUpperCase()
    if (message.category === 'SafetyCar') {
      if (text.includes('VIRTUAL SAFETY CAR DEPLOYED')) safetyCar = 'VSC'
      else if (text.includes('VSC ENDING')) safetyCar = 'VSC ENDING'
      else if (text.includes('SAFETY CAR DEPLOYED')) safetyCar = 'SC'
      else if (text.includes('SAFETY CAR IN THIS LAP')) safetyCar = 'SC ENDING'
      continue
    }
    if (scope === 'SECTOR') {
      const sector = messageSector(message)
      if (sector === null) continue
      if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW')
        sectors.set(sector, flag)
      else if (flag === 'CLEAR' || flag === 'GREEN') sectors.delete(sector)
      continue
    }
    if (scope === 'TRACK') {
      if (flag === 'RED') red = true
      else if (flag === 'GREEN' || flag === 'CLEAR' || flag === 'CHEQUERED') {
        red = false
        safetyCar = null
        sectors.clear()
      }
    }
  }
  const list = [...sectors.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sector, flag]) => ({ sector, flag }))
  const level: TrackStatus['level'] = red
    ? 'red'
    : safetyCar === 'SC' || safetyCar === 'SC ENDING'
      ? 'sc'
      : safetyCar === 'VSC' || safetyCar === 'VSC ENDING'
        ? 'vsc'
        : list.some((item) => item.flag === 'DOUBLE YELLOW')
          ? 'double-yellow'
          : list.length
            ? 'yellow'
            : 'green'
  return { level, sectors: list, safetyCar, red }
}

/** Short banner text, e.g. "Double yellow · sector 3" or "Safety car". */
export function trackStatusLabel(status: TrackStatus) {
  const sectorText = status.sectors.length
    ? ` · sector${status.sectors.length > 1 ? 's' : ''} ${status.sectors.map((item) => item.sector).join(', ')}`
    : ''
  switch (status.level) {
    case 'red':
      return 'Red flag'
    case 'sc':
      return status.safetyCar === 'SC ENDING'
        ? 'Safety car in this lap'
        : 'Safety car'
    case 'vsc':
      return status.safetyCar === 'VSC ENDING'
        ? 'Virtual safety car ending'
        : 'Virtual safety car'
    case 'double-yellow':
      return `Double yellow${sectorText}`
    case 'yellow':
      return `Yellow${sectorText}`
    default:
      return ''
  }
}

// ---------- Timing: gaps and lap times at the playhead ----------

export type IntervalRow = HistoricalInterval & { dateMs: number }

/** Groups interval rows by driver, sorted by time. */
export function intervalsByDriver(rows: HistoricalInterval[]) {
  const grouped = new Map<number, IntervalRow[]>()
  for (const row of rows) {
    const dateMs = Date.parse(row.date)
    if (!Number.isFinite(dateMs)) continue
    const list = grouped.get(row.driverNumber) ?? []
    list.push({ ...row, dateMs })
    grouped.set(row.driverNumber, list)
  }
  for (const list of grouped.values()) list.sort((a, b) => a.dateMs - b.dateMs)
  return grouped
}

/** Latest interval at or before the playhead, if no older than maxAgeMs. */
export function intervalAt(
  rows: IntervalRow[] | undefined,
  timestampMs: number,
  maxAgeMs = 20_000,
): IntervalRow | null {
  if (!rows?.length) return null
  let low = 0
  let high = rows.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (rows[mid].dateMs <= timestampMs) low = mid + 1
    else high = mid
  }
  const latest = rows[low - 1]
  return latest && timestampMs - latest.dateMs <= maxAgeMs ? latest : null
}

export function formatGap(seconds: number | null, laps: number | null) {
  if (laps !== null && laps > 0) return `+${laps} LAP${laps > 1 ? 'S' : ''}`
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  return `+${seconds.toFixed(3)}`
}

export type TimedLap = HistoricalLap & { endMs: number }

/** Completed, timed laps per driver, sorted by when they finished. */
export function timedLapsByDriver(laps: HistoricalLap[]) {
  const grouped = new Map<number, TimedLap[]>()
  for (const lap of laps) {
    if (!lap.dateStart || lap.lapDuration == null || lap.lapDuration <= 0)
      continue
    const startMs = Date.parse(lap.dateStart)
    if (!Number.isFinite(startMs)) continue
    const list = grouped.get(lap.driverNumber) ?? []
    list.push({ ...lap, endMs: startMs + lap.lapDuration * 1_000 })
    grouped.set(lap.driverNumber, list)
  }
  for (const list of grouped.values()) list.sort((a, b) => a.endMs - b.endMs)
  return grouped
}

/** Last completed lap and personal best so far, at the playhead. */
export function lapTimingAt(laps: TimedLap[] | undefined, timestampMs: number) {
  let last: TimedLap | null = null
  let best: TimedLap | null = null
  for (const lap of laps ?? []) {
    if (lap.endMs > timestampMs) break
    last = lap
    if (!best || lap.lapDuration! < best.lapDuration!) best = lap
  }
  return { last, best }
}

/**
 * Estimated retirement time for each DNF driver. OpenF1 has no retirement
 * timestamp, so this is the end of the last recorded lap: its own time, or
 * the driver's median lap if the last lap was never completed.
 */
export function retirementTimes(
  laps: HistoricalLap[],
  results: HistoricalSessionResult[],
) {
  const retired = new Map<number, number>()
  for (const result of results) {
    if (!result.dnf || result.dns) continue
    let lastStart = -Infinity
    let lastDuration: number | null = null
    const durations: number[] = []
    for (const lap of laps) {
      if (lap.driverNumber !== result.driverNumber || !lap.dateStart) continue
      const startMs = Date.parse(lap.dateStart)
      if (!Number.isFinite(startMs)) continue
      if (lap.lapDuration != null && lap.lapDuration > 0)
        durations.push(lap.lapDuration)
      if (startMs > lastStart) {
        lastStart = startMs
        lastDuration = lap.lapDuration
      }
    }
    if (!Number.isFinite(lastStart)) continue
    durations.sort((a, b) => a - b)
    const typical = durations[Math.floor(durations.length / 2)] ?? 120
    const seconds =
      lastDuration != null && lastDuration > 0 ? lastDuration : typical
    retired.set(result.driverNumber, lastStart + seconds * 1_000)
  }
  return retired
}

// ---------- Circuit landmarks from recorded data ----------

export type WorldMarker = { x: number; y: number; dx: number; dy: number }

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Start/finish line estimate. Every recorded lap start is a car crossing the
 * line, so the median of car positions at those moments (interpolated between
 * samples at most 2 s apart) marks it. `dx/dy` is the direction of travel.
 */
export function startFinishEstimate(
  laps: HistoricalLap[],
  samples: HistoricalPosition[],
): WorldMarker | null {
  const byDriver = new Map<number, { t: number; x: number; y: number }[]>()
  for (const row of removeSharedStationaryPositions(samples)) {
    if (row.x == null || row.y == null) continue
    const t = Date.parse(row.date)
    if (!Number.isFinite(t)) continue
    const list = byDriver.get(row.driverNumber) ?? []
    list.push({ t, x: row.x, y: row.y })
    byDriver.set(row.driverNumber, list)
  }
  for (const list of byDriver.values()) list.sort((a, b) => a.t - b.t)
  const xs: number[] = []
  const ys: number[] = []
  let dirX = 0
  let dirY = 0
  for (const lap of laps) {
    if (lap.lapNumber < 2 || !lap.dateStart) continue
    const list = byDriver.get(lap.driverNumber)
    const t = Date.parse(lap.dateStart)
    if (!list || !Number.isFinite(t)) continue
    let low = 0
    let high = list.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (list[mid].t <= t) low = mid + 1
      else high = mid
    }
    const before = list[low - 1]
    const after = list[low]
    if (!before || !after || after.t - before.t > 2_000) continue
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy)
    if (length < 1) continue
    const share = (t - before.t) / Math.max(after.t - before.t, 1)
    xs.push(before.x + dx * share)
    ys.push(before.y + dy * share)
    dirX += dx / length
    dirY += dy / length
  }
  if (xs.length < 3) return null
  const length = Math.hypot(dirX, dirY) || 1
  return { x: median(xs), y: median(ys), dx: dirX / length, dy: dirY / length }
}

/**
 * Pit stops to trace the pit lane from, most typical first: ordinary stops
 * (15–40 s in the lane) ordered by distance from the median lane time. Each
 * is an [entry, exit] window in ms. Callers try them in order because some
 * stops carry only placeholder positions.
 */
export function pitLaneTraceCandidates(pitStops: HistoricalPitStop[]) {
  const ordinary = pitStops
    .map((stop) => ({ stop, exitMs: Date.parse(stop.date) }))
    .filter(
      ({ stop, exitMs }) =>
        Number.isFinite(exitMs) &&
        stop.laneDuration != null &&
        stop.laneDuration >= 15 &&
        stop.laneDuration <= 40,
    )
  if (!ordinary.length) return []
  const typical = median(ordinary.map(({ stop }) => stop.laneDuration!))
  return ordinary
    .sort(
      (a, b) =>
        Math.abs(a.stop.laneDuration! - typical) -
        Math.abs(b.stop.laneDuration! - typical),
    )
    .map(({ stop, exitMs }) => ({
      driverNumber: stop.driverNumber,
      fromMs: exitMs - stop.laneDuration! * 1_000 - 1_000,
      toMs: exitMs + 1_000,
    }))
}
