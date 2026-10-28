import { expect, test } from '@playwright/test'
import type {
  HistoricalCarSample,
  HistoricalLap,
  HistoricalPitStop,
  HistoricalPosition,
  HistoricalSessionResult,
  HistoricalStint,
} from '../src/lib/api.js'
import { bestSectors, compareDrivers } from '../src/features/replay/compare.js'
import {
  aeroAidChanges,
  radioClipTime,
  radioClips,
  radioClipsCrossed,
  formatGap,
  intervalAt,
  intervalsByDriver,
  lapTimingAt,
  timedLapsByDriver,
  trackStatusAt,
  trackStatusEvents,
  trackStatusLabel,
  aeroAidStateAt,
  createTrackProjection,
  interpolatePosition,
  driverTrackStatusAt,
  finalResultStatus,
  lapAt,
  normalizeCarSamples,
  normalizePositions,
  pitStopVisitAt,
  placeDriverLabels,
  ReplayClock,
  removeSharedStationaryPositions,
  retimeAlongPath,
  replayStatusAt,
  stintAt,
  tyreAtReplayTime,
  telemetryAt,
  type FrameScheduler,
} from '../src/features/replay/replay-engine.js'

const date = (ms: number) => new Date(ms).toISOString()

function makeClock() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, (timestamp: number) => void>()
  const frames: FrameScheduler = {
    request: (callback) => {
      const id = nextId++
      pending.set(id, callback)
      return id
    },
    cancel: (id) => pending.delete(id),
    now: () => now,
  }
  const advance = (timestamp: number) => {
    now = timestamp
    const next = pending.entries().next().value as
      [number, (timestamp: number) => void] | undefined
    if (next) {
      pending.delete(next[0])
      next[1](timestamp)
    }
  }
  return { clock: new ReplayClock(10_000, 5_000, frames), advance, pending }
}

test('replay clock has one seekable timestamp and advances by selected speed', () => {
  const { clock, advance } = makeClock()
  clock.play()
  advance(500)
  expect(clock.getSnapshot().timestampMs).toBe(10_500)
  clock.setSpeed(2)
  advance(750)
  expect(clock.getSnapshot().elapsedMs).toBe(1_000)
  clock.seek(4_000)
  expect(clock.getSnapshot().timestampMs).toBe(14_000)
  clock.dispose()
})

test('replay clock pauses, resumes, and stops at the session boundary', () => {
  const { clock, advance, pending } = makeClock()
  clock.play()
  advance(400)
  clock.pause()
  expect(clock.getSnapshot().elapsedMs).toBe(400)
  expect(pending.size).toBe(0)
  clock.play()
  advance(700)
  expect(clock.getSnapshot().elapsedMs).toBe(700)
  clock.setSpeed(8)
  advance(1_300)
  expect(clock.getSnapshot()).toMatchObject({
    elapsedMs: 5_000,
    isPlaying: false,
  })
  clock.dispose()
})

test('position normalization sorts timestamps and keeps the final duplicate', () => {
  const rows: HistoricalPosition[] = [
    { date: date(2_000), x: 20, y: 0, z: null, driverNumber: 1 },
    { date: date(1_000), x: 10, y: 0, z: null, driverNumber: 1 },
    { date: date(1_000), x: 11, y: 0, z: null, driverNumber: 1 },
    { date: 'invalid', x: 99, y: 0, z: null, driverNumber: 1 },
  ]
  expect(normalizePositions(rows).map((row) => row.x)).toEqual([11, 20])
})

test('shared stationary provider coordinates are removed from a circuit trace', () => {
  const sharedPlaceholder = [1, 2, 3, 4].flatMap((driverNumber) =>
    [0, 3_000, 6_000].map((offset) => ({
      date: date(offset),
      x: -8_325,
      y: -7_058,
      z: 0,
      driverNumber,
    })),
  )
  const actualTrackSamples: HistoricalPosition[] = [
    { date: date(1_000), x: 20, y: 10, z: 0, driverNumber: 44 },
    { date: date(1_500), x: 40, y: 30, z: 0, driverNumber: 44 },
  ]
  expect(
    removeSharedStationaryPositions([
      ...sharedPlaceholder,
      ...actualTrackSamples,
    ]),
  ).toEqual(actualTrackSamples)
})

test('briefly shared coordinates are kept when they are not stationary', () => {
  const simultaneousSamples: HistoricalPosition[] = [1, 2, 3, 4].map(
    (driverNumber) => ({
      date: date(1_000),
      x: 20,
      y: 10,
      z: 0,
      driverNumber,
    }),
  )
  expect(removeSharedStationaryPositions(simultaneousSamples)).toEqual(
    simultaneousSamples,
  )
})

test('position interpolation is timestamp weighted and never crosses a large gap', () => {
  const points = [
    { dateMs: 1_000, x: 10, y: 0 },
    { dateMs: 1_500, x: 30, y: 20 },
    { dateMs: 4_000, x: 50, y: 30 },
  ]
  expect(interpolatePosition(points, 1_250)).toEqual({ x: 20, y: 10 })
  expect(interpolatePosition(points, 2_000)).toBeNull()
  expect(interpolatePosition(points, 1_000)).toEqual({ x: 10, y: 0 })
})

test('position interpolation smooths uneven sample cadence without overshooting', () => {
  const points = [
    { x: 0, y: 0, dateMs: 0 },
    { x: 100, y: 100, dateMs: 1_000 },
    { x: 110, y: 110, dateMs: 2_000 },
  ]

  const beforeSample = interpolatePosition(points, 999)
  const atSample = interpolatePosition(points, 1_000)
  const afterSample = interpolatePosition(points, 1_001)

  expect(beforeSample?.x).toBeGreaterThan(99)
  expect(atSample).toEqual({ x: 100, y: 100 })
  expect(afterSample?.x).toBeGreaterThan(100)
  expect(afterSample?.x).toBeLessThan(101)
  expect(interpolatePosition(points, 500)?.x).toBeGreaterThan(50)
})

test('telemetry interpolates continuous channels and holds discrete state at the playhead', () => {
  const samples: HistoricalCarSample[] = [
    {
      date: date(1_000),
      driverNumber: 44,
      speed: 100,
      throttle: 20,
      brake: 0,
      rpm: 5_000,
      gear: 3,
      drs: 8,
    },
    {
      date: date(2_000),
      driverNumber: 44,
      speed: 200,
      throttle: 80,
      brake: 1,
      rpm: 9_000,
      gear: 4,
      drs: 10,
    },
  ]
  const normalized = normalizeCarSamples([...samples].reverse())
  expect(telemetryAt(normalized, 1_500)).toMatchObject({
    speed: 150,
    throttle: 50,
    rpm: 7_000,
    brake: 0,
    gear: 3,
    drs: 8,
  })
  expect(telemetryAt(normalized, 5_001)).toBeNull()
})

test('lap lookup stays within the matching driver and advances at lap timestamps', () => {
  const laps: HistoricalLap[] = [
    {
      driverNumber: 1,
      lapNumber: 1,
      dateStart: date(1_000),
      lapDuration: 90,
      sector1Duration: null,
      sector2Duration: null,
      sector3Duration: null,
      isPitOutLap: false,
    },
    {
      driverNumber: 1,
      lapNumber: 2,
      dateStart: date(91_000),
      lapDuration: 91,
      sector1Duration: null,
      sector2Duration: null,
      sector3Duration: null,
      isPitOutLap: true,
    },
    {
      driverNumber: 4,
      lapNumber: 1,
      dateStart: date(1_500),
      lapDuration: 92,
      sector1Duration: null,
      sector2Duration: null,
      sector3Duration: null,
      isPitOutLap: false,
    },
  ]
  expect(lapAt(laps, 1, 90_999)?.lapNumber).toBe(1)
  expect(lapAt(laps, 1, 91_000)?.lapNumber).toBe(2)
  expect(lapAt(laps, 4, 91_000)?.lapNumber).toBe(1)
  expect(lapAt(laps, 7, 91_000)).toBeNull()
})

test('tyre compound follows the driver current lap and stint boundaries', () => {
  const stints: HistoricalStint[] = [
    {
      driverNumber: 4,
      stintNumber: 1,
      compound: 'MEDIUM',
      lapStart: 1,
      lapEnd: 12,
      tyreAgeAtStart: 0,
    },
    {
      driverNumber: 4,
      stintNumber: 2,
      compound: 'HARD',
      lapStart: 13,
      lapEnd: 30,
      tyreAgeAtStart: 0,
    },
  ]
  expect(stintAt(stints, 4, 12)?.compound).toBe('MEDIUM')
  expect(stintAt(stints, 4, 13)?.compound).toBe('HARD')
  expect(stintAt(stints, 4, null)).toBeNull()
  expect(stintAt(stints, 8, 13)).toBeNull()
})

test('DNS driver retains the provider-reported tyre when lap timing is absent', () => {
  const stint: HistoricalStint = {
    driverNumber: 1,
    stintNumber: 1,
    compound: 'HARD',
    lapStart: 1,
    lapEnd: 1,
    tyreAgeAtStart: 0,
  }
  const result: HistoricalSessionResult = {
    driverNumber: 1,
    dnf: false,
    dns: true,
    dsq: false,
    position: null,
    numberOfLaps: 0,
  }
  expect(tyreAtReplayTime([stint], [], 1, 10_000, result)).toEqual({
    stint,
    certainty: 'last-reported',
  })
})

test('DNS always wins, but DNF/DSQ cars keep their track status while recorded', () => {
  const position: HistoricalPosition = {
    date: date(9_000),
    x: 100,
    y: 200,
    z: null,
    driverNumber: 1,
  }
  const result: HistoricalSessionResult = {
    driverNumber: 1,
    dnf: false,
    dns: true,
    dsq: false,
    position: null,
    numberOfLaps: 0,
  }
  expect(replayStatusAt(1, 10_000, [position], [], result)).toBe('DNS')
  const dnf = { ...result, dns: false, dnf: true }
  const dsq = { ...result, dns: false, dsq: true }
  // Recent sample: the car was still running at the playhead.
  expect(replayStatusAt(1, 10_000, [position], [], dnf)).toBe('ON TRACK')
  expect(replayStatusAt(1, 10_000, [position], [], dsq)).toBe('ON TRACK')
  // No recent sample: fall back to the final classification.
  expect(replayStatusAt(1, 60_000, [position], [], dnf)).toBe('DNF')
  expect(replayStatusAt(1, 60_000, [position], [], dsq)).toBe('DSQ')
})

test('pit lane visit starts at recorded end minus lane duration and turns off at exit', () => {
  const positions: HistoricalPosition[] = [
    { date: date(1_000), x: 10, y: 20, z: null, driverNumber: 4 },
  ]
  const pits: HistoricalPitStop[] = [
    { date: date(30_000), driverNumber: 4, lapNumber: 3, laneDuration: 22 },
  ]
  expect(driverTrackStatusAt(4, 1_800, positions, pits)).toBe('ON TRACK')
  expect(driverTrackStatusAt(4, 3_001, positions, pits)).toBe('NO DATA')
  expect(driverTrackStatusAt(4, 7_999, positions, pits)).toBe('NO DATA')
  expect(driverTrackStatusAt(4, 8_000, positions, pits)).toBe('PIT LANE')
  expect(pitStopVisitAt(4, 8_000, pits)).toEqual(pits[0])
  expect(driverTrackStatusAt(4, 29_999, positions, pits)).toBe('PIT LANE')
  expect(pitStopVisitAt(4, 29_999, pits)).toEqual(pits[0])
  expect(driverTrackStatusAt(4, 30_000, positions, pits)).toBe('NO DATA')
  expect(pitStopVisitAt(4, 30_000, pits)).toBeNull()
  expect(pitStopVisitAt(3, 20_000, pits)).toBeNull()
  expect(
    pitStopVisitAt(4, 20_000, [{ ...pits[0], laneDuration: null }]),
  ).toBeNull()
})

test('pit lane status stays unavailable for invalid dates and nonpositive durations', () => {
  const validStop: HistoricalPitStop = {
    date: date(30_000),
    driverNumber: 4,
    lapNumber: 3,
    laneDuration: 22,
  }
  for (const laneDuration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(
      pitStopVisitAt(4, 20_000, [{ ...validStop, laneDuration }]),
    ).toBeNull()
  }
  expect(
    pitStopVisitAt(4, 20_000, [{ ...validStop, date: 'invalid date' }]),
  ).toBeNull()
})

test('final retirement states remain sourced from the official result record', () => {
  const result: HistoricalSessionResult = {
    driverNumber: 4,
    dnf: true,
    dns: false,
    dsq: false,
    position: null,
    numberOfLaps: 10,
  }
  expect(finalResultStatus(result)).toBe('DNF')
  expect(finalResultStatus({ ...result, dnf: false, dns: true })).toBe('DNS')
  expect(finalResultStatus({ ...result, dnf: false, dsq: true })).toBe('DSQ')
  expect(finalResultStatus({ ...result, dnf: false })).toBeNull()
})

test('dense driver labels do not collide and preserve selected-driver priority', () => {
  const targets = Array.from({ length: 10 }, (_, index) => ({
    driverNumber: index + 1,
    acronym: `D${String(index).padStart(2, '0')}`,
    x: 360,
    y: 230,
    selected: index === 7,
  }))
  const placements = placeDriverLabels(targets)
  expect(placements).toHaveLength(targets.length)
  expect(placements[0].driverNumber).toBe(8)
  for (let i = 0; i < placements.length; i++) {
    const a = {
      left: placements[i].x,
      top: placements[i].y - 15,
      right: placements[i].x + 31,
      bottom: placements[i].y + 4,
    }
    expect(a.left).toBeGreaterThanOrEqual(0)
    expect(a.right).toBeLessThanOrEqual(500)
    for (let j = i + 1; j < placements.length; j++) {
      const b = {
        left: placements[j].x,
        top: placements[j].y - 15,
        right: placements[j].x + 31,
        bottom: placements[j].y + 4,
      }
      expect(
        a.left >= b.right ||
          b.left >= a.right ||
          a.top >= b.bottom ||
          b.top >= a.bottom,
      ).toBe(true)
    }
  }
  const stable = placeDriverLabels(
    targets,
    500,
    350,
    new Map(
      placements.map((item) => [
        item.driverNumber,
        { dx: item.x - item.markerX, dy: item.y - item.markerY - 15 },
      ]),
    ),
  )
  expect(stable.map(({ x, y }) => [x, y])).toEqual(
    placements.map(({ x, y }) => [x, y]),
  )
})

test('driver labels keep their chosen slot under small marker movement', () => {
  const first = placeDriverLabels([
    { driverNumber: 44, acronym: 'HAM', x: 200, y: 180, selected: true },
    { driverNumber: 16, acronym: 'LEC', x: 225, y: 180, selected: false },
  ])
  const offsets = new Map(
    first.map((item) => [
      item.driverNumber,
      { dx: item.x - item.markerX, dy: item.y - item.markerY - 15 },
    ]),
  )
  const moved = placeDriverLabels(
    [
      { driverNumber: 44, acronym: 'HAM', x: 201, y: 180.5, selected: true },
      { driverNumber: 16, acronym: 'LEC', x: 224, y: 180.5, selected: false },
    ],
    500,
    350,
    offsets,
  )
  expect(moved.map(({ driverNumber }) => driverNumber)).toEqual(
    first.map(({ driverNumber }) => driverNumber),
  )
  expect(
    moved.map((item) => [item.x - item.markerX, item.y - item.markerY - 15]),
  ).toEqual(
    first.map((item) => [item.x - item.markerX, item.y - item.markerY - 15]),
  )
})

test('driver label placement tolerates minor overlap before changing its slot', () => {
  const previous = new Map([
    [1, { dx: 0, dy: -9 }],
    [2, { dx: 0, dy: -9 }],
  ])
  const targets = [
    { driverNumber: 1, acronym: 'HAM', x: 100, y: 100, selected: true },
    { driverNumber: 2, acronym: 'LEC', x: 131, y: 100, selected: false },
  ]
  const stable = placeDriverLabels(targets, 500, 350, previous)
  expect(stable.find((item) => item.driverNumber === 2)?.x).toBe(131)
  const crowded = placeDriverLabels(
    [targets[0], { ...targets[1], x: 120 }],
    500,
    350,
    previous,
  )
  expect(crowded.find((item) => item.driverNumber === 2)?.x).not.toBe(120)
})

test('multiple driver positions share the same replay timestamp across playback speeds', () => {
  const { clock, advance } = makeClock()
  const observed = new Map<number, number>()
  clock.subscribe(({ timestampMs }) => {
    observed.set(44, timestampMs)
    observed.set(16, timestampMs)
  })
  clock.play()
  let frameAt = 0
  for (const speed of [1, 2, 5, 10]) {
    clock.setSpeed(speed)
    const before = clock.getSnapshot().elapsedMs
    frameAt += 100
    advance(frameAt)
    expect(clock.getSnapshot().elapsedMs - before).toBe(100 * speed)
    expect(observed.get(44)).toBe(observed.get(16))
  }
  clock.pause()
  const pausedAt = clock.getSnapshot().timestampMs
  advance(10_000)
  expect(clock.getSnapshot().timestampMs).toBe(pausedAt)
  clock.seek(300)
  expect(observed.get(44)).toBe(10_300)
  clock.seek(100)
  expect(observed.get(16)).toBe(10_100)
  clock.dispose()
})

test('track orientation ignores panel size and never mirrors', () => {
  // A tall right triangle in world space (Y up), counter-clockwise.
  const corners = [
    { x: 0, y: 0 },
    { x: 1_000, y: 0 },
    { x: 0, y: 4_000 },
  ]
  const samples: HistoricalPosition[] = corners.map((corner, index) => ({
    date: date(index * 1_000),
    x: corner.x,
    y: corner.y,
    z: null,
    driverNumber: 1,
  }))
  const signedArea = (points: { x: number; y: number }[]) =>
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0)
  const span = (points: { x: number; y: number }[], axis: 'x' | 'y') =>
    Math.max(...points.map((p) => p[axis])) -
    Math.min(...points.map((p) => p[axis]))
  // Normal and full-screen panels of different shapes.
  for (const size of [
    { width: 800, height: 300 },
    { width: 300, height: 800 },
  ]) {
    const projection = createTrackProjection(samples, size)!
    const screen = corners.map((c) => projection.project(c.x, c.y))
    // The tall circuit is always laid on its side…
    expect(span(screen, 'x')).toBeGreaterThan(span(screen, 'y'))
    // …as a rotation: Y flips on screen, so world CCW becomes screen CW.
    expect(Math.sign(signedArea(screen))).toBe(-Math.sign(signedArea(corners)))
    for (const point of screen) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(size.width)
      expect(point.y).toBeLessThanOrEqual(size.height)
    }
  }
})

test('overtake mode state follows race control enable/disable notices', () => {
  const message = (ms: number, text: string) => ({
    date: date(ms),
    category: 'Other',
    flag: null,
    scope: null,
    message: text,
    driverNumber: null,
    lapNumber: null,
  })
  const changes = aeroAidChanges(
    [
      message(30_000, 'OVERTAKE ENABLED'),
      message(10_000, 'OVERTAKE DISABLED'),
      message(20_000, 'DRS ENABLED'),
      message(40_000, 'CAR 44 (HAM) TIME 1:35.1 DELETED'),
      message(50_000, 'Overtake mode disabled'),
    ],
    'OVERTAKE',
  )
  expect(changes.map((change) => change.enabled)).toEqual([false, true, false])
  expect(aeroAidStateAt(changes, 5_000)).toBe('unknown')
  expect(aeroAidStateAt(changes, 15_000)).toBe('disabled')
  expect(aeroAidStateAt(changes, 30_000)).toBe('enabled')
  expect(aeroAidStateAt(changes, 60_000)).toBe('disabled')
  expect(aeroAidChanges([message(1, 'DRS DISABLED')], 'DRS')).toHaveLength(1)
})

test('track status follows sector yellows, safety car and track-wide green', () => {
  const rc = (
    ms: number,
    category: string,
    flag: string | null,
    scope: string | null,
    text: string,
    sector: number | null = null,
  ) => ({
    date: date(ms),
    category,
    flag,
    scope,
    sector,
    message: text,
    driverNumber: null,
    lapNumber: null,
  })
  const events = trackStatusEvents([
    rc(10_000, 'Flag', 'YELLOW', 'Sector', 'YELLOW IN TRACK SECTOR 3', 3),
    // Sector missing from the field: parsed from the message text.
    rc(
      12_000,
      'Flag',
      'DOUBLE YELLOW',
      'Sector',
      'DOUBLE YELLOW IN TRACK SECTOR 4',
    ),
    rc(20_000, 'Flag', 'CLEAR', 'Sector', 'CLEAR IN TRACK SECTOR 4', 4),
    rc(30_000, 'SafetyCar', null, null, 'SAFETY CAR DEPLOYED'),
    rc(40_000, 'SafetyCar', null, null, 'SAFETY CAR IN THIS LAP'),
    rc(50_000, 'Flag', 'GREEN', 'Track', 'TRACK CLEAR'),
    rc(60_000, 'SafetyCar', null, null, 'VIRTUAL SAFETY CAR DEPLOYED'),
    rc(70_000, 'Flag', 'RED', 'Track', 'RED FLAG'),
    rc(5_000, 'Other', null, null, 'OVERTAKE ENABLED'),
  ])
  expect(trackStatusAt(events, 5_000).level).toBe('green')
  const yellow = trackStatusAt(events, 13_000)
  expect(yellow.level).toBe('double-yellow')
  expect(yellow.sectors).toEqual([
    { sector: 3, flag: 'YELLOW' },
    { sector: 4, flag: 'DOUBLE YELLOW' },
  ])
  expect(trackStatusLabel(yellow)).toBe('Double yellow in marshal sectors 3, 4')
  expect(trackStatusAt(events, 25_000).level).toBe('yellow')
  expect(trackStatusLabel(trackStatusAt(events, 35_000))).toBe('Safety car')
  expect(trackStatusLabel(trackStatusAt(events, 45_000))).toBe(
    'Safety car in this lap',
  )
  const green = trackStatusAt(events, 55_000)
  expect(green.level).toBe('green')
  expect(green.sectors).toEqual([])
  expect(trackStatusAt(events, 65_000).level).toBe('vsc')
  expect(trackStatusAt(events, 75_000).level).toBe('red')
})

test('retiming evens out jittered timestamps without moving any point', () => {
  // Constant speed: 10 units every 250 ms, with ±80 ms timestamp jitter.
  const jitter = [0, 80, -60, 70, -80, 50, -40, 60, -70, 0]
  const points = jitter.map((offset, index) => ({
    x: index * 10,
    y: 0,
    dateMs: 1_000 + index * 250 + offset,
    segment: 0,
  }))
  const retimed = retimeAlongPath(points)
  expect(retimed.map((point) => [point.x, point.y])).toEqual(
    points.map((point) => [point.x, point.y]),
  )
  const raw = points.slice(1).map((p, i) => p.dateMs - points[i].dateMs)
  const even = retimed.slice(1).map((p, i) => p.dateMs - retimed[i].dateMs)
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(spread(even)).toBeLessThan(spread(raw) / 2)
  for (const [index, point] of retimed.entries())
    expect(Math.abs(point.dateMs - points[index].dateMs)).toBeLessThanOrEqual(
      250,
    )
  // A stationary car keeps its recorded times.
  const parked = [0, 1, 2, 3].map((index) => ({
    x: 5,
    y: 5,
    dateMs: index * 300,
    segment: 0,
  }))
  expect(retimeAlongPath(parked)).toEqual(parked)
})

test('gaps and lap timing are read at the playhead without looking ahead', () => {
  const rows = intervalsByDriver([
    {
      date: date(10_000),
      driverNumber: 4,
      gapToLeaderSeconds: 1.2,
      gapToLeaderLaps: null,
      intervalSeconds: 0.4,
      intervalLaps: null,
    },
    {
      date: date(14_000),
      driverNumber: 4,
      gapToLeaderSeconds: null,
      gapToLeaderLaps: 1,
      intervalSeconds: 3.5,
      intervalLaps: null,
    },
  ])
  expect(intervalAt(rows.get(4), 9_000)).toBeNull()
  expect(intervalAt(rows.get(4), 12_000)?.gapToLeaderSeconds).toBe(1.2)
  expect(intervalAt(rows.get(4), 60_000)).toBeNull()
  expect(formatGap(1.2, null)).toBe('+1.200')
  expect(formatGap(null, 2)).toBe('+2 LAPS')
  expect(formatGap(null, null)).toBe('—')
  const lap = (lapNumber: number, startMs: number, seconds: number | null) => ({
    lapNumber,
    dateStart: date(startMs),
    lapDuration: seconds,
    sector1Duration: null,
    sector2Duration: null,
    sector3Duration: null,
    isPitOutLap: false,
    driverNumber: 4,
  })
  const laps = timedLapsByDriver([
    lap(1, 0, 95),
    lap(2, 95_000, 92),
    lap(3, 187_000, 94),
    lap(4, 281_000, null),
  ]).get(4)
  expect(lapTimingAt(laps, 94_000)).toEqual({ last: null, best: null })
  const afterThree = lapTimingAt(laps, 281_000)
  expect(afterThree.last?.lapNumber).toBe(3)
  expect(afterThree.best?.lapNumber).toBe(2)
})

test('driver comparison only uses laps finished before the playhead', () => {
  const lap = (
    driverNumber: number,
    lapNumber: number,
    startMs: number,
    seconds: number,
    s1: number,
  ) => ({
    driverNumber,
    lapNumber,
    dateStart: date(startMs),
    lapDuration: seconds,
    sector1Duration: s1,
    sector2Duration: 30,
    sector3Duration: seconds - s1 - 30,
    isPitOutLap: false,
  })
  const laps = [
    lap(1, 1, 0, 90, 30),
    lap(1, 2, 90_000, 91, 29.5),
    lap(2, 1, 1_000, 90.5, 30.2),
    lap(2, 2, 91_500, 90, 30.1),
  ]
  const events = [
    {
      timeMs: 100_000,
      message: {
        date: date(100_000),
        category: 'SafetyCar',
        flag: null,
        scope: null,
        sector: null,
        message: 'VIRTUAL SAFETY CAR DEPLOYED',
        driverNumber: null,
        lapNumber: 2,
      },
    },
  ]
  const early = compareDrivers({
    laps,
    pitStops: [],
    events,
    a: 1,
    b: 2,
    untilMs: 92_000,
  })
  expect(early.map((row) => row.lap)).toEqual([1])
  expect(early[0].delta).toBeCloseTo(-0.5)
  expect(early[0].gap).toBeCloseTo(-1.5)
  const rows = compareDrivers({
    laps,
    pitStops: [
      { date: date(150_000), driverNumber: 2, lapNumber: 2, laneDuration: 21 },
    ],
    events,
    a: 1,
    b: 2,
    untilMs: 200_000,
  })
  expect(rows[1]).toMatchObject({
    lap: 2,
    pitA: false,
    pitB: true,
    neutralised: 'vsc',
  })
  expect(rows[1].gap).toBeCloseTo(-0.5)
  expect(bestSectors(rows, 'a')[0]).toBe(29.5)
})

test('team radio clips are timed from the recording, not the feed', () => {
  const url = (stamp: string) =>
    `https://livetiming.formula1.com/static/2026/x/TeamRadio/ANT_12_${stamp}.mp3`
  // Austin (UTC-5): recorded 15:00:45 local, published 31 s later.
  expect(
    new Date(
      radioClipTime('2026-10-25T20:01:16.664Z', url('20261025_150045')),
    ).toISOString(),
  ).toBe('2026-10-25T20:00:45.000Z')
  // File time after the feed time is implausible: keep the feed time.
  expect(
    radioClipTime('2026-10-25T20:01:16.000Z', url('20261025_150300')),
  ).toBe(Date.parse('2026-10-25T20:01:16.000Z'))
  // No timestamp in the name.
  expect(radioClipTime('2026-10-25T20:01:16.000Z', 'https://x/clip.mp3')).toBe(
    Date.parse('2026-10-25T20:01:16.000Z'),
  )
  const clips = radioClips([
    {
      date: '2026-10-25T20:05:00Z',
      driverNumber: 4,
      recordingUrl: 'https://x/b.mp3',
    },
    {
      date: '2026-10-25T20:01:00Z',
      driverNumber: 12,
      recordingUrl: 'https://x/a.mp3',
    },
  ])
  expect(clips.map((clip) => clip.driverNumber)).toEqual([12, 4])
  const t = Date.parse('2026-10-25T20:01:00Z')
  expect(radioClipsCrossed(clips, t - 1_000, t).length).toBe(1)
  expect(radioClipsCrossed(clips, t, t + 1_000).length).toBe(0)
})
