import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { accentStyle } from '@/lib/accent'
import {
  DriverCard,
  TelemetryPanel,
  type AeroContext,
} from '@/features/replay/telemetry-panel'
import '@/features/replay/replay-visuals.css'
import { ControlDeck, type DeckMarker } from '@/features/replay/control-deck'
import {
  formatClock,
  formatElapsed,
  formatLapTime,
} from '@/features/replay/format'
import { TyreGraphic, TyreLoader } from '@/features/replay/tyre'
import { compoundColour } from '@/features/replay/tyre-colours'
import { RadioNowPlaying, type RadioContext } from '@/features/replay/radio'
import { useRadioPlayer } from '@/features/replay/radio-player'
import {
  getCarData,
  getClassification,
  getIntervals,
  getRaceControl,
  getRacePositions,
  getSessionLaps,
  saveSessionArchive,
  getSessionDrivers,
  getSessionPitStops,
  getSessionResults,
  getSessionStints,
  getTeamRadio,
  type HistoricalCarSample,
  type HistoricalClassificationChange,
  type HistoricalDriver,
  type HistoricalLap,
  type HistoricalPosition,
  type HistoricalPitStop,
  type HistoricalSessionResult,
  type HistoricalStint,
  type RaceSession,
} from '@/lib/api'
import {
  aeroAidChanges,
  createTrackProjection,
  formatGap,
  intervalAt,
  intervalsByDriver,
  lapTimingAt,
  timedLapsByDriver,
  trackStatusAt,
  trackStatusEvents,
  trackStatusLabel,
  type RaceControlEvent,
  interpolatePosition,
  finalResultStatus,
  lapAt,
  normalizeCarSamples,
  pitStopVisitAt,
  placeDriverLabels,
  removeSharedStationaryPositions,
  ReplayClock,
  recordedDurationMs,
  trackStatusBands,
  retimeAlongPath,
  radioClips,
  type RadioClip,
  pitLaneTraceCandidates,
  startFinishEstimate,
  retirementTimes,
  replayStatusAt,
  tyreAtReplayTime,
  type MapSize,
  type ReplayPoint,
  type TrackProjection,
} from '@/features/replay/replay-engine'

const WINDOW_MS = 180_000
/** The API only saves sessions that ended at least six hours ago. */
const ARCHIVE_SETTLE_MS = 6 * 3_600_000
const STALE_MS = 30 * 60_000
const GC_MS = 15 * 60_000
const NO_DRIVERS: HistoricalDriver[] = []
const NO_POSITIONS: HistoricalPosition[] = []
const NO_CLASSIFICATION: HistoricalClassificationChange[] = []
const NO_CAR_DATA: HistoricalCarSample[] = []
const NO_LAPS: HistoricalLap[] = []
const NO_STINTS: HistoricalStint[] = []
const NO_PIT_STOPS: HistoricalPitStop[] = []
const NO_RESULTS: HistoricalSessionResult[] = []
const DEFAULT_MAP_SIZE: MapSize = { width: 720, height: 460 }

type DriverPath = { driver: HistoricalDriver; points: ReplayPoint[] }

// The replay clock fires every animation frame. Writing identical values
// still invalidates style and layout, so only touch the DOM on change.
function setText(node: HTMLElement, value: string) {
  if (node.textContent !== value) node.textContent = value
}
function setData(node: HTMLElement, key: string, value: string) {
  if (node.dataset[key] !== value) node.dataset[key] = value
}
function setTitle(node: HTMLElement, value: string) {
  if (node.title !== value) node.title = value
}

function utc(value: number) {
  return new Date(value).toISOString()
}

/** The selected driver's pit stops, placed at the estimated lane entry. */
function pitMarkers(
  driverNumber: number | undefined,
  pitStops: HistoricalPitStop[],
  startMs: number,
  durationMs: number,
): DeckMarker[] {
  if (driverNumber === undefined || durationMs <= 0) return []
  const markers: DeckMarker[] = []
  for (const [index, stop] of pitStops.entries()) {
    if (stop.driverNumber !== driverNumber) continue
    const stopTimeMs = Date.parse(stop.date)
    if (!Number.isFinite(stopTimeMs)) continue
    const hasLane =
      stop.laneDuration !== null && Number.isFinite(stop.laneDuration)
    const timeMs = hasLane
      ? stopTimeMs - stop.laneDuration! * 1_000
      : stopTimeMs
    if (timeMs < startMs || timeMs > startMs + durationMs) continue
    markers.push({
      id: `pit-${stopTimeMs}-${index}`,
      timeMs,
      kind: 'pit',
      label: `pit stop${stop.lapNumber ? `, lap ${stop.lapNumber}` : ''}`,
      detail: hasLane
        ? `Estimated lane entry, ${formatPitDuration(stop.laneDuration)}`
        : 'Recorded pit time, lane time unavailable',
    })
  }
  return markers
}

function radioMarkers(
  clips: RadioClip[],
  drivers: HistoricalDriver[],
  startMs: number,
  durationMs: number,
): DeckMarker[] {
  const acronyms = new Map(
    drivers.map((driver) => [driver.driverNumber, driver.nameAcronym]),
  )
  return clips
    .filter(
      (clip) => clip.timeMs >= startMs && clip.timeMs <= startMs + durationMs,
    )
    .map((clip) => {
      const name = acronyms.get(clip.driverNumber) ?? `#${clip.driverNumber}`
      return {
        id: clip.id,
        timeMs: clip.timeMs,
        kind: 'radio' as const,
        label: `${name} team radio`,
        detail: `Team radio from ${name}`,
      }
    })
}

function formatPitDuration(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? 'Duration unavailable'
    : `${value.toFixed(1)} s lane time`
}

type TowerMode = 'timing' | 'compact'
const TOWER_MODE_KEY = 'pitlane.towerMode'

function readTowerMode(): TowerMode {
  try {
    return localStorage.getItem(TOWER_MODE_KEY) === 'compact'
      ? 'compact'
      : 'timing'
  } catch {
    return 'timing'
  }
}

function teamColor(color: string) {
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#aeb7c2'
}

function windowBounds(startMs: number, durationMs: number, index: number) {
  const from = startMs + index * WINDOW_MS
  const to = Math.min(from + WINDOW_MS, startMs + durationMs)
  return from < to ? { fromUtc: utc(from), toUtc: utc(to), fromMs: from } : null
}

function toPaths(
  samples: HistoricalPosition[],
  drivers: HistoricalDriver[],
  projection: TrackProjection | null,
) {
  if (!projection) return []
  const byNumber = new Map<number, HistoricalPosition[]>()
  for (const sample of removeSharedStationaryPositions(samples)) {
    const points = byNumber.get(sample.driverNumber) ?? []
    points.push(sample)
    byNumber.set(sample.driverNumber, points)
  }
  const driversByNumber = new Map(
    drivers.map((driver) => [driver.driverNumber, driver]),
  )
  return [...byNumber.entries()].flatMap(([driverNumber, rows]) => {
    const driver = driversByNumber.get(driverNumber)
    if (!driver) return []
    let segment = 0
    let previousDate: number | null = null
    const points: ReplayPoint[] = []
    for (const row of rows) {
      const dateMs = Date.parse(row.date)
      if (
        row.x === null ||
        row.y === null ||
        !Number.isFinite(row.x) ||
        !Number.isFinite(row.y)
      ) {
        segment++
        previousDate = null
        continue
      }
      if (previousDate !== null && dateMs - previousDate > 1_500) segment++
      const projected = projection.project(row.x, row.y)
      points.push({
        ...projected,
        dateMs,
        segment,
      })
      previousDate = dateMs
    }
    return points.length ? [{ driver, points: retimeAlongPath(points) }] : []
  })
}

function pathSegments(points: ReplayPoint[]) {
  const segments: string[] = []
  let segment: ReplayPoint[] = []
  for (const point of points) {
    const previous = segment.at(-1)
    if (
      previous &&
      (point.dateMs - previous.dateMs > 1_500 ||
        (point.segment !== undefined &&
          previous.segment !== undefined &&
          point.segment !== previous.segment))
    ) {
      if (segment.length > 1)
        segments.push(
          segment
            .map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`)
            .join(' '),
        )
      segment = []
    }
    segment.push(point)
  }
  if (segment.length > 1)
    segments.push(
      segment
        .map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`)
        .join(' '),
    )
  return segments
}

function currentOrder(
  drivers: HistoricalDriver[],
  events: HistoricalClassificationChange[],
  dateMs: number,
) {
  const positions = new Map<number, number>()
  for (const event of events) {
    if (Date.parse(event.date) > dateMs) break
    positions.set(event.driverNumber, event.position)
  }
  return [...drivers]
    .sort((a, b) => {
      const positionA = positions.get(a.driverNumber)
      const positionB = positions.get(b.driverNumber)
      if (positionA !== undefined && positionB !== undefined)
        return positionA - positionB
      if (positionA !== undefined) return -1
      if (positionB !== undefined) return 1
      return a.driverNumber - b.driverNumber
    })
    .map((driver) => ({
      driver,
      position: positions.get(driver.driverNumber) ?? null,
    }))
}

export function RaceReplay({ session }: { session: RaceSession }) {
  const startMs = Date.parse(session.dateStart)
  const endMs = session.dateEnd ? Date.parse(session.dateEnd) : NaN
  // OpenF1's end is the scheduled slot (two hours for every race). It only
  // sizes the replay until recorded laps arrive; see recordedDurationMs.
  const scheduledMs = endMs - startMs
  const validSchedule = Number.isFinite(scheduledMs) && scheduledMs > 0
  const clock = useMemo(
    () => new ReplayClock(startMs, validSchedule ? scheduledMs : 0),
    [scheduledMs, startMs, validSchedule],
  )
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [windowIndex, setWindowIndex] = useState(0)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [classificationIndex, setClassificationIndex] = useState(-1)
  const [mapSize, setMapSize] = useState<MapSize>(DEFAULT_MAP_SIZE)
  const [immersive, setImmersive] = useState(false)
  const [towerMode, setTowerMode] = useState<TowerMode>(readTowerMode)
  const rangeRef = useRef<HTMLInputElement>(null)
  const lapRef = useRef<HTMLSpanElement>(null)
  const lapTimeRef = useRef<HTMLElement>(null)
  const tyreNodes = useRef(new Map<number, HTMLSpanElement>())
  const statusNodes = useRef(new Map<number, HTMLSpanElement>())
  const timingNodes = useRef(new Map<number, HTMLSpanElement>())
  const selectedTyreRef = useRef<HTMLSpanElement>(null)
  const selectedTyreIconRef = useRef<HTMLElement>(null)
  const selectedStatusRef = useRef<HTMLSpanElement>(null)
  const classificationIndexRef = useRef(-1)
  const playStateRef = useRef(false)
  const windowIndexRef = useRef(0)
  const initialSampleSeekApplied = useRef(false)

  const driversQuery = useQuery({
    queryKey: ['historical-drivers', session.sessionKey],
    queryFn: ({ signal }) => getSessionDrivers(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const classification = useQuery({
    queryKey: ['historical-classification', session.sessionKey],
    queryFn: ({ signal }) => getClassification(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  // Finished sessions are saved on the API's disk in the background, so later
  // windows (and later visits) load from this computer instead of OpenF1.
  const [openedAtMs] = useState(() => Date.now())
  const finishedForArchive =
    Number.isFinite(endMs) && openedAtMs > endMs + ARCHIVE_SETTLE_MS
  const archiveQuery = useQuery({
    queryKey: ['session-archive', session.sessionKey],
    queryFn: ({ signal }) => saveSessionArchive(session.sessionKey, signal),
    enabled: finishedForArchive,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === 'queued' ||
      query.state.data?.state === 'saving'
        ? 3_000
        : false,
  })
  const sessionLapsQuery = useQuery({
    queryKey: ['historical-session-laps', session.sessionKey],
    queryFn: ({ signal }) => getSessionLaps(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const recorded = useMemo(
    () =>
      recordedDurationMs(
        sessionLapsQuery.data?.items ?? NO_LAPS,
        startMs,
        validSchedule ? scheduledMs : 0,
      ),
    [scheduledMs, sessionLapsQuery.data, startMs, validSchedule],
  )
  const durationMs = recorded.durationMs
  const validDuration = Number.isFinite(durationMs) && durationMs > 0
  useEffect(() => {
    clock.setDuration(validDuration ? durationMs : 0)
  }, [clock, durationMs, validDuration])
  const startWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex)
    : null
  const endWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex + 1)
    : null
  // One fixed window defines the circuit outline; car positions still come
  // from the active replay window. It starts at the first recorded lap 2, when
  // cars are at racing speed. A fixed minute offset fails on delayed starts:
  // at Suzuka 2026 it caught only pit-lane crawling and drew a straight line.
  const firstLapTwoMs = useMemo(() => {
    let earliest = Infinity
    for (const lap of sessionLapsQuery.data?.items ?? NO_LAPS) {
      if (lap.lapNumber !== 2 || !lap.dateStart) continue
      const lapStartMs = Date.parse(lap.dateStart)
      if (Number.isFinite(lapStartMs)) earliest = Math.min(earliest, lapStartMs)
    }
    return earliest
  }, [sessionLapsQuery.data])
  const circuitWindow = !validDuration
    ? null
    : sessionLapsQuery.isPending
      ? null
      : Number.isFinite(firstLapTwoMs) &&
          firstLapTwoMs >= startMs &&
          firstLapTwoMs < startMs + durationMs
        ? {
            fromMs: firstLapTwoMs,
            fromUtc: utc(firstLapTwoMs),
            toUtc: utc(
              Math.min(firstLapTwoMs + WINDOW_MS, startMs + durationMs),
            ),
          }
        : windowBounds(startMs, durationMs, 1)
  // Gaps come in 3-minute windows. The previous window is kept too, so the
  // latest gap before the playhead is known right after a window boundary.
  const intervalWindows = validDuration
    ? [windowIndex - 1, windowIndex]
        .filter((index) => index >= 0)
        .map((index) => windowBounds(startMs, durationMs, index))
    : []
  const previousIntervalWindow =
    intervalWindows.length > 1 ? intervalWindows[0] : null
  const currentIntervalWindow = intervalWindows.at(-1) ?? null
  const previousIntervalsQuery = useQuery({
    queryKey: [
      'historical-intervals',
      session.sessionKey,
      previousIntervalWindow?.fromUtc,
    ],
    queryFn: ({ signal }) =>
      getIntervals(
        session.sessionKey,
        previousIntervalWindow!.fromUtc,
        previousIntervalWindow!.toUtc,
        signal,
      ),
    enabled: previousIntervalWindow !== null,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const currentIntervalsQuery = useQuery({
    queryKey: [
      'historical-intervals',
      session.sessionKey,
      currentIntervalWindow?.fromUtc,
    ],
    queryFn: ({ signal }) =>
      getIntervals(
        session.sessionKey,
        currentIntervalWindow!.fromUtc,
        currentIntervalWindow!.toUtc,
        signal,
      ),
    enabled: currentIntervalWindow !== null,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const intervals = useMemo(
    () =>
      intervalsByDriver([
        ...(previousIntervalsQuery.data?.items ?? []),
        ...(currentIntervalsQuery.data?.items ?? []),
      ]),
    [previousIntervalsQuery.data, currentIntervalsQuery.data],
  )
  const stintsQuery = useQuery({
    queryKey: ['historical-session-stints', session.sessionKey],
    queryFn: ({ signal }) => getSessionStints(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const pitStopsQuery = useQuery({
    queryKey: ['historical-session-pit-stops', session.sessionKey],
    queryFn: ({ signal }) => getSessionPitStops(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const raceControlQuery = useQuery({
    queryKey: ['historical-race-control', session.sessionKey],
    queryFn: ({ signal }) => getRaceControl(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const teamRadioQuery = useQuery({
    queryKey: ['historical-team-radio', session.sessionKey],
    queryFn: ({ signal }) => getTeamRadio(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const clips = useMemo(
    () => radioClips(teamRadioQuery.data?.items ?? []),
    [teamRadioQuery.data],
  )
  const radioPlayer = useRadioPlayer(clock, clips)
  const aero = useMemo<AeroContext>(
    () => ({
      modernRules: new Date(startMs).getUTCFullYear() >= 2026,
      overtakeChanges: aeroAidChanges(
        raceControlQuery.data?.items ?? [],
        'OVERTAKE',
      ),
      raceControl: raceControlQuery.isPending
        ? 'loading'
        : raceControlQuery.isError
          ? 'unavailable'
          : 'ready',
    }),
    [
      raceControlQuery.data,
      raceControlQuery.isError,
      raceControlQuery.isPending,
      startMs,
    ],
  )
  const resultsQuery = useQuery({
    queryKey: ['historical-session-results', session.sessionKey],
    queryFn: ({ signal }) => getSessionResults(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const positions = useQuery({
    queryKey: [
      'historical-race-positions',
      session.sessionKey,
      startWindow?.fromMs,
    ],
    queryFn: ({ signal }) =>
      getRacePositions(
        session.sessionKey,
        startWindow!.fromUtc,
        startWindow!.toUtc,
        signal,
      ),
    enabled: startWindow !== null,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  useQuery({
    queryKey: [
      'historical-race-positions',
      session.sessionKey,
      endWindow?.fromMs,
    ],
    queryFn: ({ signal }) =>
      getRacePositions(
        session.sessionKey,
        endWindow!.fromUtc,
        endWindow!.toUtc,
        signal,
      ),
    enabled: endWindow !== null,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const circuitPositions = useQuery({
    queryKey: [
      'historical-race-positions',
      session.sessionKey,
      circuitWindow?.fromMs,
    ],
    queryFn: ({ signal }) =>
      getRacePositions(
        session.sessionKey,
        circuitWindow!.fromUtc,
        circuitWindow!.toUtc,
        signal,
      ),
    enabled: circuitWindow !== null,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })

  const drivers = driversQuery.data?.items ?? NO_DRIVERS
  const finalResults = resultsQuery.data?.items ?? NO_RESULTS
  const resultsByDriver = useMemo(
    () => new Map(finalResults.map((result) => [result.driverNumber, result])),
    [finalResults],
  )
  const defaultDriver = useMemo(() => {
    const winner = [...finalResults]
      .filter((result) => !result.dns && result.position !== null)
      .sort((a, b) => a.position! - b.position!)[0]
    return (
      drivers.find((driver) => driver.driverNumber === winner?.driverNumber) ??
      drivers.find(
        (driver) => !resultsByDriver.get(driver.driverNumber)?.dns,
      ) ??
      drivers[0]
    )
  }, [drivers, finalResults, resultsByDriver])
  const selectedDriver =
    drivers.find((driver) => driver.driverNumber === selectedNumber) ??
    defaultDriver
  const carData = useQuery({
    queryKey: [
      'historical-car-data',
      session.sessionKey,
      selectedDriver?.driverNumber,
      startWindow?.fromMs,
    ],
    queryFn: ({ signal }) =>
      getCarData(
        session.sessionKey,
        selectedDriver!.driverNumber,
        startWindow!.fromUtc,
        startWindow!.toUtc,
        signal,
      ),
    enabled: startWindow !== null && selectedDriver !== undefined,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const driversReady = driversQuery.isSuccess && drivers.length > 0
  const samples = positions.data?.items ?? NO_POSITIONS
  const circuitSamples = circuitPositions.data?.items ?? NO_POSITIONS
  // Only non-starters are hidden. DNF/DSQ cars raced until they stopped, and
  // their recorded positions are real.
  const excludedMapDriverNumbers = useMemo(
    () =>
      new Set(
        finalResults
          .filter((result) => result.dns)
          .map((result) => result.driverNumber),
      ),
    [finalResults],
  )
  // DNF cars leave the map once they retire (estimated from their last lap).
  const retiredAt = useMemo(
    () =>
      retirementTimes(sessionLapsQuery.data?.items ?? NO_LAPS, finalResults),
    [finalResults, sessionLapsQuery.data],
  )
  const validPositionSamples = useMemo(
    () => removeSharedStationaryPositions(samples),
    [samples],
  )
  const movingSamples = useMemo(
    () =>
      validPositionSamples.filter((sample) => {
        if (excludedMapDriverNumbers.has(sample.driverNumber)) return false
        const retiredMs = retiredAt.get(sample.driverNumber)
        return retiredMs === undefined || Date.parse(sample.date) < retiredMs
      }),
    [excludedMapDriverNumbers, retiredAt, validPositionSamples],
  )
  const positionsByDriver = useMemo(() => {
    const grouped = new Map<number, HistoricalPosition[]>()
    for (const sample of movingSamples) {
      const rows = grouped.get(sample.driverNumber) ?? []
      rows.push(sample)
      grouped.set(sample.driverNumber, rows)
    }
    return grouped
  }, [movingSamples])
  const mapReferenceSamples = useMemo(() => {
    const reference =
      circuitPositions.isSuccess && circuitSamples.length > 1
        ? circuitSamples
        : circuitPositions.isPending
          ? NO_POSITIONS
          : samples
    return removeSharedStationaryPositions(reference).filter(
      (sample) => !excludedMapDriverNumbers.has(sample.driverNumber),
    )
  }, [
    circuitPositions.isPending,
    circuitPositions.isSuccess,
    circuitSamples,
    excludedMapDriverNumbers,
    samples,
  ])
  const projection = useMemo(
    () => createTrackProjection(mapReferenceSamples, mapSize),
    [mapReferenceSamples, mapSize],
  )
  const paths = useMemo(
    () => toPaths(movingSamples, drivers, projection),
    [drivers, movingSamples, projection],
  )
  const circuitPaths = useMemo(
    () => toPaths(mapReferenceSamples, drivers, projection),
    [drivers, mapReferenceSamples, projection],
  )
  // Start/finish: where cars were when their recorded laps began.
  const startFinish = useMemo(() => {
    if (!projection || !circuitPositions.isSuccess) return null
    const marker = startFinishEstimate(
      sessionLapsQuery.data?.items ?? NO_LAPS,
      circuitSamples,
    )
    if (!marker) return null
    const at = projection.project(marker.x, marker.y)
    const ahead = projection.project(
      marker.x + marker.dx * 50,
      marker.y + marker.dy * 50,
    )
    return {
      x: at.x,
      y: at.y,
      angle: (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI,
    }
  }, [
    circuitPositions.isSuccess,
    circuitSamples,
    projection,
    sessionLapsQuery.data,
  ])
  // Pit lane: the recorded path of one typical pit stop.
  const pitLaneCandidates = useMemo(
    () => pitLaneTraceCandidates(pitStopsQuery.data?.items ?? NO_PIT_STOPS),
    [pitStopsQuery.data],
  )
  const pitLaneTrace = useQuery({
    queryKey: [
      'historical-pit-lane-v2',
      session.sessionKey,
      pitLaneCandidates[0]?.fromMs,
    ],
    queryFn: async ({ signal }) => {
      // Try up to five stops. Some carry only placeholder coordinates, and
      // some pit records don't match the car's motion (it never stops), so
      // each candidate is checked against recorded speed first.
      for (const candidate of pitLaneCandidates.slice(0, 5)) {
        const fromUtc = utc(candidate.fromMs)
        const toUtc = utc(candidate.toMs)
        const speeds = (
          await getCarData(
            session.sessionKey,
            candidate.driverNumber,
            fromUtc,
            toUtc,
            signal,
          )
        ).items
          .map((row) => ({ t: Date.parse(row.date), speed: row.speed }))
          .filter(
            (row): row is { t: number; speed: number } =>
              row.speed != null && Number.isFinite(row.t),
          )
          .sort((a, b) => a.t - b.t)
        const sortedSpeeds = speeds
          .map((row) => row.speed)
          .sort((a, b) => a - b)
        const medianSpeed = sortedSpeeds[Math.floor(sortedSpeeds.length / 2)]
        // A real stop: the car halts in its box and otherwise runs at the
        // pit limiter (80 km/h at most circuits, 60 at a few).
        if (!sortedSpeeds.length || sortedSpeeds[0] > 5 || medianSpeed > 95)
          continue
        // Keep only the speed-limited stretch: the pit lane itself.
        const limited = speeds.filter((row) => row.speed <= 90)
        const fromMs = limited[0].t
        const toMs = limited[limited.length - 1].t
        const response = await getRacePositions(
          session.sessionKey,
          fromUtc,
          toUtc,
          signal,
        )
        const trace = removeSharedStationaryPositions(response.items)
          .filter((row) => {
            const t = Date.parse(row.date)
            return (
              row.driverNumber === candidate.driverNumber &&
              row.x != null &&
              row.y != null &&
              !(row.x === -8325 && row.y === -7058) &&
              t >= fromMs &&
              t <= toMs
            )
          })
          .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
        // Most of the visit must have real positions.
        if (trace.length >= 30) return trace
      }
      return NO_POSITIONS
    },
    enabled: pitLaneCandidates.length > 0,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
  const pitLane = useMemo(() => {
    const trace = pitLaneTrace.data ?? NO_POSITIONS
    if (!projection || trace.length === 0) return null
    const points = trace.map((row) => projection.project(row.x!, row.y!))
    const middle = points[Math.floor(points.length / 2)]
    return {
      points: points
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' '),
      label: { x: middle.x, y: middle.y - 14 },
    }
  }, [pitLaneTrace.data, projection])
  const changes = useMemo(
    () =>
      [...(classification.data?.items ?? NO_CLASSIFICATION)].sort(
        (a, b) => Date.parse(a.date) - Date.parse(b.date),
      ),
    [classification.data],
  )
  const orderedDrivers = useMemo(
    () =>
      currentOrder(
        drivers,
        changes,
        changes[classificationIndex]?.date
          ? Date.parse(changes[classificationIndex].date)
          : startMs,
      ),
    [classificationIndex, changes, drivers, startMs],
  )
  const leaderNumber = orderedDrivers.find(({ position }) => position === 1)
    ?.driver.driverNumber
  const changeTowerMode = useCallback(
    (mode: TowerMode) => {
      setTowerMode(mode)
      try {
        localStorage.setItem(TOWER_MODE_KEY, mode)
      } catch {
        // Storage can be blocked; the choice then lasts for this visit only.
      }
    },
    [setTowerMode],
  )
  const normalizedCarData = useMemo(
    () => normalizeCarSamples(carData.data?.items ?? NO_CAR_DATA),
    [carData.data],
  )
  const allLaps = useMemo(
    () =>
      [...(sessionLapsQuery.data?.items ?? NO_LAPS)].sort((a, b) => {
        const driverOrder = a.driverNumber - b.driverNumber
        const timeA = a.dateStart ? Date.parse(a.dateStart) : Infinity
        const timeB = b.dateStart ? Date.parse(b.dateStart) : Infinity
        return driverOrder || timeA - timeB || a.lapNumber - b.lapNumber
      }),
    [sessionLapsQuery.data],
  )
  const timedLaps = useMemo(() => timedLapsByDriver(allLaps), [allLaps])
  const stints = useMemo(
    () =>
      [...(stintsQuery.data?.items ?? NO_STINTS)].sort(
        (a, b) =>
          a.driverNumber - b.driverNumber || a.stintNumber - b.stintNumber,
      ),
    [stintsQuery.data],
  )
  const pitStops = pitStopsQuery.data?.items ?? NO_PIT_STOPS
  const raceControlEvents = useMemo(
    () => trackStatusEvents(raceControlQuery.data?.items ?? []),
    [raceControlQuery.data],
  )
  // Default rival: the car ahead in the running order, or behind for P1.
  const defaultRival = useMemo(() => {
    const index = orderedDrivers.findIndex(
      ({ driver }) => driver.driverNumber === selectedDriver?.driverNumber,
    )
    if (index < 0) return null
    return (
      orderedDrivers[index > 0 ? index - 1 : index + 1]?.driver.driverNumber ??
      null
    )
  }, [orderedDrivers, selectedDriver?.driverNumber])
  const compareContext = useMemo(
    () => ({
      drivers,
      laps: allLaps,
      pitStops,
      events: raceControlEvents,
      defaultRival,
      retiredAt,
    }),
    [allLaps, defaultRival, drivers, pitStops, raceControlEvents, retiredAt],
  )
  const radioContext: RadioContext = {
    clips,
    status: teamRadioQuery.isPending
      ? 'loading'
      : teamRadioQuery.isError
        ? 'unavailable'
        : 'ready',
    player: radioPlayer,
    drivers,
    startMs,
    onSeek: (elapsedMs: number) =>
      clock.seek(Math.max(0, Math.min(elapsedMs, durationMs))),
  }
  const deckMarkers = useMemo(
    () =>
      [
        ...pitMarkers(
          selectedDriver?.driverNumber,
          pitStops,
          startMs,
          durationMs,
        ),
        ...radioMarkers(clips, drivers, startMs, durationMs),
      ].sort((a, b) => a.timeMs - b.timeMs),
    [
      clips,
      drivers,
      durationMs,
      pitStops,
      selectedDriver?.driverNumber,
      startMs,
    ],
  )
  const statusBands = useMemo(
    () => trackStatusBands(raceControlEvents, startMs + durationMs),
    [durationMs, raceControlEvents, startMs],
  )
  const selectedResult = selectedDriver
    ? resultsByDriver.get(selectedDriver.driverNumber)
    : undefined
  const selectedFinalStatus = finalResultStatus(selectedResult)
  const telemetrySamples =
    selectedFinalStatus === 'DNS' ? NO_CAR_DATA : normalizedCarData
  const selectedLap = selectedDriver
    ? lapAt(
        allLaps,
        selectedDriver.driverNumber,
        clock.getSnapshot().timestampMs,
      )
    : null
  const selectedTyre = selectedDriver
    ? tyreAtReplayTime(
        stints,
        allLaps,
        selectedDriver.driverNumber,
        clock.getSnapshot().timestampMs,
        resultsByDriver.get(selectedDriver.driverNumber),
      )
    : { stint: null, certainty: 'unavailable' as const }
  const selectedStint = selectedTyre.stint
  const totalLapsByDriver = useMemo(() => {
    const totals = new Map<number, number>()
    for (const lap of allLaps)
      totals.set(
        lap.driverNumber,
        Math.max(totals.get(lap.driverNumber) ?? 0, lap.lapNumber),
      )
    return totals
  }, [allLaps])
  const availableLapStarts = useMemo(
    () =>
      allLaps.filter((lap) => {
        if (lap.driverNumber !== selectedDriver?.driverNumber || !lap.dateStart)
          return false
        const lapStartMs = Date.parse(lap.dateStart)
        return (
          Number.isFinite(lapStartMs) &&
          lapStartMs >= startMs &&
          lapStartMs <= startMs + durationMs
        )
      }),
    [allLaps, durationMs, selectedDriver?.driverNumber, startMs],
  )
  const geometryReady = circuitPaths.length > 0
  const lapAndTyreReady = sessionLapsQuery.isSuccess && stintsQuery.isSuccess

  useEffect(() => {
    return () => clock.dispose()
  }, [clock])

  // Races and sprints open just before lights out: the earliest recorded lap 1
  // start. The formation lap stays reachable on the timeline.
  const lightsOutElapsedMs = useMemo(() => {
    if (!/race|sprint/i.test(session.sessionType)) return null
    let earliest = Infinity
    for (const lap of allLaps) {
      if (lap.lapNumber !== 1 || !lap.dateStart) continue
      const lapStartMs = Date.parse(lap.dateStart)
      if (Number.isFinite(lapStartMs)) earliest = Math.min(earliest, lapStartMs)
    }
    const elapsed = earliest - startMs
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= durationMs
      ? elapsed
      : null
  }, [allLaps, durationMs, session.sessionType, startMs])
  const firstSampleElapsedMs = useMemo(() => {
    const firstSampleMs = movingSamples.length
      ? Date.parse(movingSamples[0].date)
      : NaN
    return Number.isFinite(firstSampleMs)
      ? Math.max(0, firstSampleMs - startMs)
      : null
  }, [movingSamples, startMs])
  const lapsSettled = sessionLapsQuery.isSuccess || sessionLapsQuery.isError
  const replayStartElapsedMs =
    lightsOutElapsedMs !== null
      ? lightsOutElapsedMs
      : lapsSettled
        ? firstSampleElapsedMs
        : null

  useEffect(() => {
    if (
      initialSampleSeekApplied.current ||
      replayStartElapsedMs === null ||
      clock.getSnapshot().elapsedMs !== 0
    )
      return
    initialSampleSeekApplied.current = true
    clock.seek(replayStartElapsedMs)
  }, [clock, replayStartElapsedMs])

  useEffect(() => {
    const unsubscribe = clock.subscribe((snapshot) => {
      const lap = selectedDriver
        ? lapAt(allLaps, selectedDriver.driverNumber, snapshot.timestampMs)
        : null
      if (lapRef.current) {
        lapRef.current.textContent = lap
          ? `Lap ${lap.lapNumber} / ${totalLapsByDriver.get(lap.driverNumber) || '—'}`
          : `${formatElapsed(snapshot.elapsedMs)} elapsed`
      }
      if (lapTimeRef.current)
        lapTimeRef.current.textContent = formatLapTime(lap?.lapDuration)
      for (const [driverNumber, node] of tyreNodes.current) {
        const reading = tyreAtReplayTime(
          stints,
          allLaps,
          driverNumber,
          snapshot.timestampMs,
          resultsByDriver.get(driverNumber),
        )
        const driverLap = lapAt(allLaps, driverNumber, snapshot.timestampMs)
        const stint = reading.stint
        const compound = stint?.compound?.toUpperCase() ?? ''
        const letter = node.lastElementChild as HTMLElement | null
        if (letter) setText(letter, compound ? compound.slice(0, 1) : '—')
        setData(node, 'compound', compound)
        setTitle(
          node,
          compound
            ? `${compound} tyre · ${reading.certainty === 'at-playhead' ? `lap ${driverLap?.lapNumber ?? '—'}` : reading.certainty === 'starting' ? 'starting stint' : 'last reported'} · stint ${stint?.stintNumber ?? '—'}`
            : 'Tyre compound unavailable at this replay time',
        )
      }
      // Timing columns. Purple marks the fastest lap of the race so far,
      // green a driver's personal best, as on the broadcast.
      let overallBest = Infinity
      const lapTiming = new Map<number, ReturnType<typeof lapTimingAt>>()
      for (const [driverNumber, laps] of timedLaps) {
        const timing = lapTimingAt(laps, snapshot.timestampMs)
        lapTiming.set(driverNumber, timing)
        if (timing.best)
          overallBest = Math.min(overallBest, timing.best.lapDuration!)
      }
      for (const [driverNumber, node] of timingNodes.current) {
        const [intervalCell, gapCell, lastCell, bestCell] =
          node.children as HTMLCollectionOf<HTMLElement>
        if (!bestCell) continue
        const gap = intervalAt(
          intervals.get(driverNumber),
          snapshot.timestampMs,
        )
        const isLeader = !gap && driverNumber === leaderNumber
        setText(
          intervalCell,
          isLeader
            ? 'Leader'
            : gap
              ? formatGap(gap.intervalSeconds, gap.intervalLaps)
              : '—',
        )
        setText(
          gapCell,
          isLeader
            ? '—'
            : gap
              ? formatGap(gap.gapToLeaderSeconds, gap.gapToLeaderLaps)
              : '—',
        )
        const { last, best } = lapTiming.get(driverNumber) ?? {
          last: null,
          best: null,
        }
        setText(lastCell, formatLapTime(last?.lapDuration))
        setText(bestCell, formatLapTime(best?.lapDuration))
        setData(
          lastCell,
          'best',
          !last
            ? ''
            : last.lapDuration === overallBest
              ? 'overall'
              : last === best
                ? 'personal'
                : '',
        )
        setData(
          bestCell,
          'best',
          best && best.lapDuration === overallBest ? 'overall' : '',
        )
      }
      let selectedStatus = 'LOADING'
      let selectedStatusCode = 'loading'
      for (const [driverNumber, node] of statusNodes.current) {
        const result = resultsByDriver.get(driverNumber)
        const status =
          positions.isPending || pitStopsQuery.isPending
            ? 'LOADING'
            : (retiredAt.get(driverNumber) ?? Infinity) <= snapshot.timestampMs
              ? 'DNF'
              : replayStatusAt(
                  driverNumber,
                  snapshot.timestampMs,
                  positionsByDriver.get(driverNumber) ?? NO_POSITIONS,
                  pitStops,
                  result,
                )
        const finalResult = finalResultStatus(result)
        setText(
          node,
          status === 'ON TRACK'
            ? 'TRACK'
            : status === 'PIT LANE'
              ? 'PIT'
              : status === 'DNF'
                ? 'DNF*'
                : status,
        )
        setData(node, 'status', status.toLowerCase().replaceAll(' ', '-'))
        setData(node, 'result', finalResult ?? '')
        setTitle(
          node,
          status === 'DNS'
            ? 'Did not start · final session result'
            : status === 'DNF'
              ? 'Retired · estimated from the last recorded lap; OpenF1 has no retirement timestamp'
              : status === 'DSQ'
                ? 'Disqualified in the final classification'
                : status === 'PIT LANE'
                  ? 'Inside the recorded pit lane visit interval'
                  : finalResult
                    ? `${status} at playhead · ${finalResult} final result`
                    : `${status} at replay playhead`,
        )
        if (selectedDriver?.driverNumber === driverNumber)
          selectedStatusCode = status.toLowerCase().replaceAll(' ', '-')
        if (selectedDriver?.driverNumber === driverNumber)
          selectedStatus =
            status === 'DNS'
              ? 'DNS · DID NOT START'
              : status === 'DNF'
                ? 'RETIRED · DNF'
                : status === 'DSQ'
                  ? 'DSQ · FINAL RESULT'
                  : status
      }
      if (selectedStatusRef.current) {
        selectedStatusRef.current.textContent = selectedStatus
        selectedStatusRef.current.dataset.status = selectedStatusCode
      }
      if (selectedTyreRef.current) {
        const reading = selectedDriver
          ? tyreAtReplayTime(
              stints,
              allLaps,
              selectedDriver.driverNumber,
              snapshot.timestampMs,
              resultsByDriver.get(selectedDriver.driverNumber),
            )
          : null
        const compound = reading?.stint?.compound
        if (selectedTyreIconRef.current) {
          const colour = compoundColour(stintsQuery.isPending ? null : compound)
          if (selectedTyreIconRef.current.style.color !== colour)
            selectedTyreIconRef.current.style.color = colour
        }
        selectedTyreRef.current.textContent = stintsQuery.isPending
          ? 'Loading'
          : compound
            ? reading?.certainty === 'at-playhead'
              ? compound
              : `${compound} · ${reading?.certainty === 'starting' ? 'STARTING' : 'LAST REPORTED'}`
            : 'Unavailable'
      }
      const nextWindow = Math.floor(snapshot.elapsedMs / WINDOW_MS)
      if (windowIndexRef.current !== nextWindow) {
        windowIndexRef.current = nextWindow
        setWindowIndex(nextWindow)
      }
      let low = 0
      let high = changes.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (Date.parse(changes[mid].date) <= snapshot.timestampMs) low = mid + 1
        else high = mid
      }
      const nextClassificationIndex = low - 1
      if (nextClassificationIndex !== classificationIndexRef.current) {
        classificationIndexRef.current = nextClassificationIndex
        setClassificationIndex(nextClassificationIndex)
      }
      if (playStateRef.current !== snapshot.isPlaying) {
        playStateRef.current = snapshot.isPlaying
        setPlaying(snapshot.isPlaying)
      }
    })
    return unsubscribe
  }, [
    allLaps,
    changes,
    clock,
    durationMs,
    intervals,
    leaderNumber,
    timedLaps,
    finalResults,
    resultsByDriver,
    pitStops,
    positionsByDriver,
    positions.isPending,
    pitStopsQuery.isPending,
    selectedDriver,
    stints,
    stintsQuery.isPending,
    totalLapsByDriver,
    retiredAt,
  ])

  const seek = useCallback((value: number) => clock.seek(value), [clock])
  const retryPositions = useCallback(
    () => void positions.refetch(),
    [positions],
  )
  const retryPitStops = useCallback(
    () => void pitStopsQuery.refetch(),
    [pitStopsQuery],
  )
  const canPlay = geometryReady || samples.length > 0
  const updateMapSize = useCallback(
    (next: MapSize) =>
      setMapSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      ),
    [setMapSize],
  )
  const restart = useCallback(() => {
    clock.pause()
    clock.seek(replayStartElapsedMs ?? 0)
  }, [clock, replayStartElapsedMs])

  // Transport shortcuts. Ignored while typing or while a native control
  // (scrubber, select, button) already handles the key itself.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Esc always leaves full screen, whatever has focus.
      if (event.key === 'Escape') {
        setImmersive(false)
        return
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return
      if (event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target?.closest(
          'input, select, textarea, button, [contenteditable], [role="dialog"]',
        )
      )
        return
      const step = event.shiftKey ? 60_000 : 10_000
      const { elapsedMs, isPlaying } = clock.getSnapshot()
      if (event.key === ' ' || event.key === 'k') {
        if (!isPlaying && !canPlay) return
        event.preventDefault()
        if (isPlaying) clock.pause()
        else clock.play()
      } else if (event.key === 'ArrowLeft' || event.key === 'j') {
        event.preventDefault()
        clock.seek(elapsedMs - step)
      } else if (event.key === 'ArrowRight' || event.key === 'l') {
        event.preventDefault()
        clock.seek(elapsedMs + step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        restart()
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        setImmersive((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canPlay, clock, restart])

  // Full-screen replay: the section covers the viewport (works everywhere),
  // and native browser full screen hides the browser chrome where allowed.
  useEffect(() => {
    if (!immersive) return
    const root = document.documentElement
    root.classList.add('replay-immersive')
    if (document.fullscreenEnabled && !document.fullscreenElement)
      root.requestFullscreen().catch(() => undefined)
    function onFullscreenChange() {
      if (!document.fullscreenElement) setImmersive(false)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      root.classList.remove('replay-immersive')
      if (document.fullscreenElement)
        document.exitFullscreen().catch(() => undefined)
    }
  }, [immersive])

  if (!validDuration) {
    return (
      <ReplayMessage text="OpenF1 did not provide valid session start and end times, so this session cannot be replayed across its full duration." />
    )
  }

  const progress =
    10 +
    (driversReady ? 20 : 0) +
    (positions.isSuccess && movingSamples.length > 0 ? 30 : 0) +
    (geometryReady ? 20 : 0) +
    (lapAndTyreReady ? 20 : 0)
  const canShowProgress =
    !driversQuery.isError &&
    !positions.isError &&
    !sessionLapsQuery.isError &&
    !stintsQuery.isError &&
    !(driversQuery.isSuccess && drivers.length === 0) &&
    !(positions.isSuccess && movingSamples.length === 0)

  // Once every stage is ready the strip only repeats "READY"; hide it.
  const loadComplete =
    canShowProgress &&
    driversReady &&
    geometryReady &&
    lapAndTyreReady &&
    positions.isSuccess &&
    !circuitPositions.isPending

  return (
    <section
      className={`race-replay panel ${immersive ? 'immersive' : ''}`}
      aria-label="Race replay"
      style={accentStyle(selectedDriver?.teamColour)}
    >
      {loadComplete ? null : (
        <div className="replay-progress-strip">
          <LoadStage
            label="Drivers"
            state={
              driversQuery.isError
                ? 'failed'
                : driversQuery.isPending
                  ? 'loading'
                  : drivers.length
                    ? 'ready'
                    : 'empty'
            }
          />
          <LoadStage
            label="Position samples"
            state={
              positions.isError
                ? 'failed'
                : positions.isPending
                  ? 'loading'
                  : movingSamples.length
                    ? 'ready'
                    : 'empty'
            }
          />
          <LoadStage
            label="Circuit trace"
            state={
              circuitPositions.isError
                ? geometryReady
                  ? 'ready'
                  : 'failed'
                : circuitPositions.isPending || driversQuery.isPending
                  ? 'waiting'
                  : geometryReady
                    ? 'ready'
                    : 'empty'
            }
          />
          <LoadStage
            label="Lap & tyre data"
            state={
              sessionLapsQuery.isError || stintsQuery.isError
                ? 'failed'
                : sessionLapsQuery.isPending || stintsQuery.isPending
                  ? 'loading'
                  : allLaps.length > 0 || stints.length > 0
                    ? 'ready'
                    : 'empty'
            }
          />
          <span className="load-progress-value" aria-live="polite">
            {canShowProgress
              ? `${geometryReady && !positions.isPending ? 100 : Math.min(progress, 95)}%`
              : geometryReady
                ? 'PARTIAL'
                : 'PARTIAL'}
          </span>
        </div>
      )}

      <div className="race-replay-workspace">
        <aside
          className="race-tower"
          aria-label="Running order"
          data-mode={towerMode}
        >
          <div className="tower-title">
            <span>Running order</span>
            <div
              className="tower-mode-switch"
              role="radiogroup"
              aria-label="Tower columns"
            >
              {(['timing', 'compact'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={towerMode === mode}
                  onClick={() => changeTowerMode(mode)}
                >
                  {mode === 'timing' ? 'Timing' : 'Compact'}
                </button>
              ))}
            </div>
            <strong>
              {driversReady ? String(drivers.length).padStart(2, '0') : '—'}
            </strong>
          </div>
          <div className="race-tower-heading">
            <strong>Pos</strong>
            <span>Driver</span>
            <span>Tyre</span>
            <span className="race-tower-timing-heading">
              <span>Int</span>
              <span>Gap</span>
              <span>Last</span>
              <span>Best</span>
            </span>
            <span>Status</span>
            <span aria-label="Final result" />
          </div>
          {driversQuery.isPending ? (
            <PanelLoader label="Loading driver list" compact />
          ) : null}
          {driversQuery.isError ? (
            <PanelError
              message="Driver list could not be loaded."
              retry={() => void driversQuery.refetch()}
            />
          ) : null}
          {driversQuery.isSuccess && drivers.length === 0 ? (
            <p className="race-data-note">
              OpenF1 returned no drivers for this session.
            </p>
          ) : null}
          {sessionLapsQuery.isError ? (
            <PanelError
              message="Lap timing could not be loaded; tire selection may be incomplete."
              retry={() => void sessionLapsQuery.refetch()}
            />
          ) : null}
          {stintsQuery.isError ? (
            <PanelError
              message="Tire stint data could not be loaded."
              retry={() => void stintsQuery.refetch()}
            />
          ) : null}
          {orderedDrivers.map(({ driver, position }) => (
            <button
              key={driver.driverNumber}
              type="button"
              className={`race-driver-row ${selectedDriver?.driverNumber === driver.driverNumber ? 'selected' : ''}`}
              style={
                {
                  '--driver-color': teamColor(driver.teamColour),
                } as CSSProperties
              }
              onClick={() => setSelectedNumber(driver.driverNumber)}
              aria-pressed={
                selectedDriver?.driverNumber === driver.driverNumber
              }
            >
              <strong className="race-driver-position">
                {position ?? '—'}
              </strong>
              <span className="race-driver-acronym">{driver.nameAcronym}</span>
              <span
                className="race-driver-tyre"
                ref={(node) => {
                  if (node) tyreNodes.current.set(driver.driverNumber, node)
                  else tyreNodes.current.delete(driver.driverNumber)
                }}
                aria-label={`Tyre compound for ${driver.nameAcronym}`}
              >
                <TyreGraphic />
                <b>
                  {driver.driverNumber === selectedDriver?.driverNumber
                    ? (selectedStint?.compound?.slice(0, 1) ?? '—')
                    : '—'}
                </b>
              </span>
              <span
                className="race-driver-timing"
                ref={(node) => {
                  if (node) timingNodes.current.set(driver.driverNumber, node)
                  else timingNodes.current.delete(driver.driverNumber)
                }}
              >
                <span title="Interval to the car ahead">—</span>
                <span title="Gap to the leader">—</span>
                <span title="Last completed lap">—</span>
                <span title="Best lap so far">—</span>
              </span>
              <span
                className="race-driver-status"
                ref={(node) => {
                  if (node) statusNodes.current.set(driver.driverNumber, node)
                  else statusNodes.current.delete(driver.driverNumber)
                }}
                data-status="no-data"
              >
                —
              </span>
              <span
                className="race-driver-result"
                data-result={finalResultStatus(
                  finalResults.find(
                    (item) => item.driverNumber === driver.driverNumber,
                  ),
                )?.toLowerCase()}
              >
                {finalResultStatus(resultsByDriver.get(driver.driverNumber)) ??
                  ''}
              </span>
            </button>
          ))}
          {classification.isPending ? (
            <p className="race-data-note">Timing order loads independently.</p>
          ) : null}
          {classification.isError ? (
            <PanelError
              message="Classification timing is unavailable."
              retry={() => void classification.refetch()}
            />
          ) : null}
        </aside>

        <TrackMap
          clock={clock}
          paths={paths}
          circuitPaths={circuitPaths}
          startFinish={startFinish}
          pitLane={pitLane}
          radioNow={
            radioPlayer.nowPlaying
              ? {
                  clip: radioPlayer.nowPlaying,
                  progress: radioPlayer.progress,
                  onStop: radioPlayer.stop,
                }
              : null
          }
          pitLaneMissing={
            pitLaneTrace.isSuccess && pitLaneTrace.data.length === 0
          }
          pitStops={pitStops}
          drivers={drivers}
          selectedDriver={selectedDriver}
          driversPending={driversQuery.isPending}
          positionsPending={positions.isPending}
          positionsError={
            positions.isError ? 'Position samples could not be loaded.' : null
          }
          positionsEmpty={positions.isSuccess && samples.length === 0}
          retiredOnly={
            positions.isSuccess &&
            samples.length > 0 &&
            movingSamples.length === 0
          }
          circuitPending={circuitPositions.isPending}
          onRetry={retryPositions}
          onSelectDriver={setSelectedNumber}
          size={mapSize}
          onResize={updateMapSize}
          raceControlEvents={raceControlEvents}
        />

        <aside className="telemetry-rail" aria-label="Selected car telemetry">
          <DriverCard driver={selectedDriver} />
          <div className="telemetry-session-state">
            <span>
              STATUS <b ref={selectedStatusRef}>NO DATA</b>
            </span>
            <span>
              TYRE{' '}
              <span className="selected-tyre">
                <i
                  className="selected-tyre-icon"
                  ref={selectedTyreIconRef}
                  style={{ color: compoundColour(selectedStint?.compound) }}
                >
                  <TyreGraphic />
                </i>
                <b ref={selectedTyreRef}>
                  {stintsQuery.isPending
                    ? 'Loading'
                    : selectedStint?.compound
                      ? selectedTyre.certainty === 'at-playhead'
                        ? selectedStint.compound
                        : `${selectedStint.compound} · ${selectedTyre.certainty === 'starting' ? 'STARTING' : 'LAST REPORTED'}`
                      : 'Unavailable'}
                </b>
              </span>
            </span>
          </div>
          {carData.isError && selectedFinalStatus !== 'DNS' ? (
            <PanelError
              message="Telemetry is unavailable for this window."
              retry={() => void carData.refetch()}
            />
          ) : null}
          {carData.isPending && selectedFinalStatus !== 'DNS' ? (
            <PanelLoader label="Synchronizing recorded telemetry" compact />
          ) : null}
          {selectedFinalStatus === 'DNS' ? (
            <p className="race-data-note">
              No on-track telemetry · this driver did not start.
            </p>
          ) : carData.isSuccess && telemetrySamples.length === 0 ? (
            <p className="race-data-note">
              No telemetry samples were returned for this driver and window.
            </p>
          ) : null}
          <TelemetryPanel
            samples={telemetrySamples}
            clock={clock}
            aero={aero}
            selected={selectedDriver}
            compare={compareContext}
            radio={radioContext}
          />
          <div className="telemetry-lap-line">
            <span ref={lapRef}>0:00 elapsed</span>
            <strong ref={lapTimeRef}>
              {formatLapTime(selectedLap?.lapDuration)}
            </strong>
          </div>
          <section
            className="pit-stop-log"
            aria-label="Selected driver pit stops"
          >
            <div className="pit-stop-log-heading">
              <strong>Pit stops</strong>
              <span>
                {pitStopsQuery.isPending
                  ? 'LOADING'
                  : pitStopsQuery.isError
                    ? 'UNAVAILABLE'
                    : `${pitStops.filter((stop) => stop.driverNumber === selectedDriver?.driverNumber).length} recorded`}
              </span>
            </div>
            {pitStopsQuery.isError ? (
              <div className="pit-stop-log-empty" role="alert">
                Pit stop records could not be loaded.
                <button type="button" onClick={retryPitStops}>
                  Retry
                </button>
              </div>
            ) : pitStopsQuery.isPending ? (
              <p className="pit-stop-log-empty">Loading recorded pit stops…</p>
            ) : !selectedDriver ? (
              <p className="pit-stop-log-empty">
                Select a driver to view pit stops.
              </p>
            ) : pitStops.filter(
                (stop) => stop.driverNumber === selectedDriver.driverNumber,
              ).length === 0 ? (
              <p className="pit-stop-log-empty">
                No pit stops recorded for this driver.
              </p>
            ) : (
              <ol>
                {pitStops
                  .filter(
                    (stop) => stop.driverNumber === selectedDriver.driverNumber,
                  )
                  .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
                  .map((stop, index) =>
                    (() => {
                      const eventEndMs = Date.parse(stop.date)
                      const visitStartMs =
                        stop.laneDuration === null
                          ? NaN
                          : eventEndMs - stop.laneDuration * 1_000
                      return (
                        <li key={`${stop.date}-${index}`}>
                          <button
                            type="button"
                            disabled={!Number.isFinite(visitStartMs)}
                            onClick={() => {
                              if (Number.isFinite(visitStartMs))
                                seek(visitStartMs - startMs)
                            }}
                            title={`Seek to pit lane entry · recorded lane time ${formatPitDuration(stop.laneDuration)}`}
                          >
                            <span className="pit-stop-main">
                              <b>LAP {stop.lapNumber ?? '—'}</b>
                              <strong>
                                {Number.isFinite(visitStartMs)
                                  ? formatElapsed(visitStartMs - startMs)
                                  : 'TIME UNAVAILABLE'}
                              </strong>
                            </span>
                            <span className="pit-stop-meta">
                              <span>
                                {Number.isFinite(visitStartMs)
                                  ? `${formatClock(visitStartMs)} entry`
                                  : 'ENTRY TIME UNAVAILABLE'}
                              </span>
                              <span>
                                {formatPitDuration(stop.laneDuration)}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })(),
                  )}
              </ol>
            )}
            <small>Click a stop to seek to its estimated lane entry.</small>
          </section>
          <p className="telemetry-footnote">
            Recorded values at the replay timestamp. Tyre compound and final
            classification depend on session coverage.
          </p>
        </aside>
      </div>

      <ControlDeck
        clock={clock}
        startMs={startMs}
        durationMs={validDuration ? durationMs : 0}
        finishMs={recorded.finishMs}
        playing={playing}
        canPlay={canPlay}
        speed={speed}
        onSpeedChange={(value) => {
          setSpeed(value)
          clock.setSpeed(value)
        }}
        immersive={immersive}
        onToggleImmersive={() => setImmersive((value) => !value)}
        onRestart={restart}
        restartsAtLightsOut={lightsOutElapsedMs !== null}
        laps={availableLapStarts}
        lapsState={
          sessionLapsQuery.isPending
            ? 'loading'
            : sessionLapsQuery.isError
              ? 'unavailable'
              : availableLapStarts.length
                ? 'ready'
                : 'empty'
        }
        totalLaps={
          selectedDriver
            ? (totalLapsByDriver.get(selectedDriver.driverNumber) ?? null)
            : null
        }
        bands={statusBands}
        markers={deckMarkers}
        rangeRef={rangeRef}
        archive={archiveQuery.data}
        notice={
          positions.isError ||
          (!positions.isPending && movingSamples.length === 0) ? (
            <p
              className="deck-notice"
              role={positions.isError ? 'alert' : 'status'}
            >
              {positions.isError
                ? 'Recorded car positions could not be loaded. Retry from the circuit panel.'
                : 'No recorded car positions are available in this part of the replay.'}
            </p>
          ) : null
        }
      />
    </section>
  )
}

type LoadState = 'loading' | 'ready' | 'empty' | 'failed' | 'waiting'

function LoadStage({ label, state }: { label: string; state: LoadState }) {
  const text = {
    loading: 'Loading',
    ready: 'Ready',
    empty: 'No data',
    failed: 'Failed',
    waiting: 'Waiting',
  }[state]
  return (
    <span className={`load-stage ${state}`}>
      <i /> <span>{label}</span>
      <b>{text}</b>
    </span>
  )
}

function PanelLoader({
  label,
  compact = false,
}: {
  label: string
  compact?: boolean
}) {
  return <TyreLoader label={label} compact={compact} />
}

function PanelError({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  return (
    <div className="panel-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  )
}

function TrackMap({
  clock,
  paths,
  circuitPaths,
  pitStops,
  drivers,
  selectedDriver,
  driversPending,
  positionsPending,
  positionsError,
  positionsEmpty,
  retiredOnly,
  circuitPending,
  onRetry,
  onSelectDriver,
  size,
  onResize,
  raceControlEvents,
  startFinish,
  pitLane,
  pitLaneMissing,
  radioNow,
}: {
  pitLaneMissing: boolean
  radioNow: { clip: RadioClip; progress: number; onStop: () => void } | null
  raceControlEvents: RaceControlEvent[]
  startFinish: { x: number; y: number; angle: number } | null
  pitLane: { points: string; label: { x: number; y: number } } | null
  size: MapSize
  onResize: (size: MapSize) => void
  clock: ReplayClock
  paths: DriverPath[]
  circuitPaths: DriverPath[]
  pitStops: HistoricalPitStop[]
  drivers: HistoricalDriver[]
  selectedDriver?: HistoricalDriver
  driversPending: boolean
  positionsPending: boolean
  positionsError: string | null
  positionsEmpty: boolean
  retiredOnly: boolean
  circuitPending: boolean
  onRetry: () => void
  onSelectDriver: (driverNumber: number) => void
}) {
  const [overflowDriverNumbers, setOverflowDriverNumbers] = useState<number[]>(
    [],
  )
  const [overflowOpen, setOverflowOpen] = useState(false)
  const groupRef = useRef<SVGGElement>(null)
  const emptyNoteRef = useRef<HTMLParagraphElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const flagBannerRef = useRef<HTMLParagraphElement>(null)

  // Track status from race control: tints the map and names the condition.
  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        const status = trackStatusAt(raceControlEvents, timestampMs)
        const panel = panelRef.current
        if (panel && panel.dataset.trackStatus !== status.level)
          panel.dataset.trackStatus = status.level
        const banner = flagBannerRef.current
        if (!banner) return
        const label = trackStatusLabel(status)
        if (banner.textContent !== label) banner.textContent = label
        const hidden = label === ''
        if (banner.hidden !== hidden) banner.hidden = hidden
      }),
    [clock, raceControlEvents],
  )
  const svgRef = useRef<SVGSVGElement>(null)
  const overflowBadgeRef = useRef<SVGGElement>(null)
  const labelElements = useRef(new Map<number, SVGGElement>())
  const previousOffsets = useRef(new Map<number, { dx: number; dy: number }>())
  const overflowDriverNumbersRef = useRef<number[]>([])
  const track = useMemo(
    () =>
      [...circuitPaths].sort((a, b) => b.points.length - a.points.length)[0],
    [circuitPaths],
  )
  const selectedPath = paths.find(
    (path) => path.driver.driverNumber === selectedDriver?.driverNumber,
  )
  const pathsByNumber = useMemo(
    () => new Map(paths.map((path) => [path.driver.driverNumber, path])),
    [paths],
  )
  const segments = useMemo(
    () => (track ? pathSegments(track.points) : []),
    [track],
  )
  const selectedSegments = useMemo(
    () => (selectedPath ? pathSegments(selectedPath.points) : []),
    [selectedPath],
  )
  const markerDrivers = useMemo(
    () =>
      drivers.filter((driver) =>
        paths.some((path) => path.driver.driverNumber === driver.driverNumber),
      ),
    [drivers, paths],
  )
  // Ring the car whose radio is playing.
  const speaking = radioNow?.clip.driverNumber
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    for (const node of group.querySelectorAll('[data-driver]'))
      node.toggleAttribute(
        'data-speaking',
        Number(node.getAttribute('data-driver')) === speaking,
      )
  }, [speaking, markerDrivers])

  // Match the drawing's aspect ratio to the panel so the circuit fills it.
  // Width stays fixed in drawing units so stroke and label sizes keep scale.
  useEffect(() => {
    const element = svgRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width < 1 || height < 1) return
      // Fewer units on phones so car labels stay legible when scaled down.
      const units = width < 520 ? 480 : DEFAULT_MAP_SIZE.width
      const scaled = Math.round((units * height) / width / 10) * 10
      const next = {
        width: units,
        height: Math.max(240, Math.min(scaled, 1200)),
      }
      onResize(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [onResize])

  useEffect(() => {
    const markerNodes = new Map<
      number,
      {
        group: SVGGElement | null
        dot: SVGCircleElement | null
        hit: SVGCircleElement | null
        ring: SVGCircleElement | null
        pit: SVGGElement | null
      }
    >()
    if (!groupRef.current) return
    for (const driver of markerDrivers) {
      const group = groupRef.current.querySelector<SVGGElement>(
        `[data-driver="${driver.driverNumber}"]`,
      )
      markerNodes.set(driver.driverNumber, {
        group,
        dot: group?.querySelector('.race-car-dot') ?? null,
        hit: group?.querySelector('.race-car-hit-area') ?? null,
        ring: group?.querySelector('.race-car-ring') ?? null,
        pit: group?.querySelector('.race-pit-indicator') ?? null,
      })
    }
    const unsubscribe = clock.subscribe(({ timestampMs }) => {
      const targets: {
        driverNumber: number
        acronym: string
        x: number
        y: number
        selected: boolean
      }[] = []
      for (const driver of markerDrivers) {
        const pointPath = pathsByNumber.get(driver.driverNumber)
        const point = pointPath
          ? interpolatePosition(pointPath.points, timestampMs)
          : null
        const node = markerNodes.get(driver.driverNumber)
        if (!node?.group || !node.dot || !node.hit || !node.ring || !node.pit)
          continue
        const isPitLaneVisit =
          pitStopVisitAt(driver.driverNumber, timestampMs, pitStops) !== null
        node.dot.style.opacity = point ? '1' : '0'
        node.hit.style.pointerEvents = point ? 'all' : 'none'
        node.ring.style.opacity =
          point &&
          (isPitLaneVisit ||
            driver.driverNumber === selectedDriver?.driverNumber)
            ? '1'
            : '0'
        node.ring.style.stroke = isPitLaneVisit ? '#f4bd58' : '#fff'
        node.pit.style.opacity = point && isPitLaneVisit ? '1' : '0'
        if (point) {
          node.pit.setAttribute(
            'transform',
            `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`,
          )
        }
        node.pit.setAttribute(
          'aria-label',
          isPitLaneVisit
            ? 'Inside recorded pit lane visit'
            : 'No active pit lane visit',
        )
        const label = labelElements.current.get(driver.driverNumber)
        if (label) label.style.opacity = point ? '1' : '0'
        node.group.setAttribute(
          'aria-label',
          isPitLaneVisit
            ? `Select ${driver.fullName} on circuit · in pit lane`
            : `Select ${driver.fullName} on circuit`,
        )
        if (!point) continue
        for (const element of [node.dot, node.hit, node.ring]) {
          element.setAttribute('cx', point.x.toFixed(2))
          element.setAttribute('cy', point.y.toFixed(2))
        }
        targets.push({
          driverNumber: driver.driverNumber,
          acronym: driver.nameAcronym,
          x: point.x,
          y: point.y,
          selected: driver.driverNumber === selectedDriver?.driverNumber,
        })
      }
      const emptyNote = emptyNoteRef.current
      if (emptyNote) {
        const hidden = targets.length > 0
        if (emptyNote.hidden !== hidden) emptyNote.hidden = hidden
      }
      const placements = placeDriverLabels(
        targets,
        size.width,
        size.height,
        previousOffsets.current,
      )
      const byDriver = new Map(
        placements.map((item) => [item.driverNumber, item]),
      )
      const hiddenDrivers = targets.filter(
        (target) => !byDriver.has(target.driverNumber),
      )
      const hiddenNumbers = hiddenDrivers.map((target) => target.driverNumber)
      if (
        hiddenNumbers.length !== overflowDriverNumbersRef.current.length ||
        hiddenNumbers.some(
          (number, index) => number !== overflowDriverNumbersRef.current[index],
        )
      ) {
        overflowDriverNumbersRef.current = hiddenNumbers
        setOverflowDriverNumbers(hiddenNumbers)
      }
      const badge = overflowBadgeRef.current
      if (badge) {
        badge.setAttribute('display', hiddenDrivers.length ? '' : 'none')
        if (hiddenDrivers.length) {
          const center = hiddenDrivers.reduce(
            (result, target) => ({
              x: result.x + target.x,
              y: result.y + target.y,
            }),
            { x: 0, y: 0 },
          )
          const x = center.x / hiddenDrivers.length
          const y = center.y / hiddenDrivers.length
          badge.setAttribute(
            'transform',
            `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
          )
          badge.setAttribute(
            'aria-label',
            `Show ${hiddenDrivers.length} closely grouped drivers`,
          )
          const badgeText = badge.querySelector('text')
          if (badgeText) badgeText.textContent = `+${hiddenDrivers.length}`
        }
      }
      for (const target of targets) {
        const placement = byDriver.get(target.driverNumber)
        const node = labelElements.current.get(target.driverNumber)
        if (!node) continue
        node.style.opacity = placement ? '1' : '0'
        if (!placement) continue
        node.setAttribute(
          'transform',
          `translate(${placement.x.toFixed(1)} ${placement.y.toFixed(1)})`,
        )
        const leader = node.querySelector<SVGLineElement>('.label-leader')
        const labelText = node.querySelector<SVGTextElement>('text')
        const labelRect = node.querySelector<SVGRectElement>('rect')
        const labelWidth = Math.max(30, target.acronym.length * 7 + 10)
        if (labelText && labelText.textContent !== target.acronym) {
          labelText.textContent = target.acronym
          labelRect?.setAttribute('width', `${labelWidth}`)
        }
        if (leader) {
          leader.style.display = placement.leader ? '' : 'none'
          const localX = placement.markerX - placement.x
          const localY = placement.markerY - placement.y
          let anchorX = Math.max(0, Math.min(labelWidth, localX))
          let anchorY = Math.max(-15, Math.min(4, localY))
          if (
            localX >= 0 &&
            localX <= labelWidth &&
            localY >= -15 &&
            localY <= 4
          ) {
            const edgeDistances = [
              { x: localX, y: -15, distance: localY + 15 },
              { x: localX, y: 4, distance: 4 - localY },
              { x: 0, y: localY, distance: localX },
              { x: labelWidth, y: localY, distance: labelWidth - localX },
            ]
            const nearest = edgeDistances.reduce((best, edge) =>
              edge.distance < best.distance ? edge : best,
            )
            anchorX = nearest.x
            anchorY = nearest.y
          }
          leader.setAttribute('x1', `${localX}`)
          leader.setAttribute('y1', `${localY}`)
          leader.setAttribute('x2', `${anchorX}`)
          leader.setAttribute('y2', `${anchorY}`)
        }
      }
      previousOffsets.current = new Map(
        placements.map((item) => [
          item.driverNumber,
          { dx: item.x - item.markerX, dy: item.y - 15 - item.markerY },
        ]),
      )
    })
    return unsubscribe
  }, [
    clock,
    markerDrivers,
    pathsByNumber,
    pitStops,
    selectedDriver?.driverNumber,
    size.height,
    size.width,
  ])

  return (
    <section
      className="race-track-panel"
      aria-label="Circuit replay"
      ref={panelRef}
      data-track-status="green"
    >
      <p
        className="track-flag-banner"
        ref={flagBannerRef}
        role="status"
        aria-live="polite"
        hidden
      />
      {radioNow ? (
        <RadioNowPlaying
          clip={radioNow.clip}
          driver={drivers.find(
            (driver) => driver.driverNumber === radioNow.clip.driverNumber,
          )}
          progress={radioNow.progress}
          onStop={radioNow.onStop}
        />
      ) : null}
      <div className="race-track-topline">
        <div>
          <span className="circuit-live-dot" /> Circuit position <b>OpenF1</b>
        </div>
        <span>
          {track
            ? 'Recorded trace'
            : circuitPending
              ? 'BUILDING CIRCUIT'
              : positionsPending
                ? 'LOADING WINDOW'
                : positionsEmpty
                  ? 'NO POSITION COVERAGE'
                  : 'POSITION DATA UNAVAILABLE'}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="race-track-map"
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label="Circuit map with interactive recorded car positions"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="trackShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <linearGradient id="roadGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#70757c" />
            <stop offset=".48" stopColor="#383d44" />
            <stop offset="1" stopColor="#656b72" />
          </linearGradient>
          <pattern
            id="kerbPattern"
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="12" fill="#e7e9eb" />
            <rect x="6" width="6" height="12" fill="#e10600" />
          </pattern>
        </defs>
        <g className="track-layers">
          {segments.map((points, index) => (
            <g key={index}>
              <polyline points={points} className="track-shadow" />
              <polyline points={points} className="track-kerb" />
              <polyline points={points} className="race-track-line" />
              <polyline points={points} className="track-centerline" />
            </g>
          ))}
          {selectedSegments.map((points, index) => (
            <polyline
              key={`selected-${index}`}
              points={points}
              className="selected-route"
              style={{
                stroke: selectedDriver
                  ? teamColor(selectedDriver.teamColour)
                  : '#e10600',
              }}
            />
          ))}
        </g>
        {pitLane ? (
          <g
            className="pit-lane"
            aria-label="Pit lane, traced from a recorded pit stop"
          >
            <polyline points={pitLane.points} className="pit-lane-edge" />
            <polyline points={pitLane.points} className="pit-lane-road" />
            <text
              className="pit-lane-label"
              x={pitLane.label.x}
              y={pitLane.label.y}
            >
              PIT
            </text>
          </g>
        ) : null}
        {startFinish ? (
          <g
            className="start-finish"
            transform={`translate(${startFinish.x} ${startFinish.y}) rotate(${startFinish.angle})`}
          >
            <title>Start/finish line, estimated from recorded lap starts</title>
            <rect
              className="start-finish-edge"
              x="-5"
              y="-17"
              width="10"
              height="34"
              rx="1.5"
            />
            {Array.from({ length: 16 }, (_, index) => (
              <rect
                key={index}
                x={-4 + (index % 2) * 4}
                y={-16 + Math.floor(index / 2) * 4}
                width="4"
                height="4"
                fill={(index + Math.floor(index / 2)) % 2 ? '#111' : '#f4f5f6'}
              />
            ))}
          </g>
        ) : null}
        <g ref={groupRef}>
          {markerDrivers.map((driver) => (
            <g
              key={driver.driverNumber}
              data-driver={driver.driverNumber}
              className="race-car-marker"
              role="button"
              tabIndex={0}
              aria-label={`Select ${driver.fullName} on circuit`}
              aria-pressed={
                driver.driverNumber === selectedDriver?.driverNumber
              }
              onClick={() => onSelectDriver(driver.driverNumber)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectDriver(driver.driverNumber)
                }
              }}
            >
              <circle
                className="race-car-hit-area"
                r="15"
                fill="transparent"
                opacity="0"
              />
              <circle className="race-car-ring" r="12" opacity="0" />
              <circle
                className="race-car-dot"
                r={
                  driver.driverNumber === selectedDriver?.driverNumber ? 7 : 5.8
                }
                style={{ fill: teamColor(driver.teamColour) }}
                opacity="0"
              />
              <g className="race-pit-indicator" opacity="0" aria-hidden="true">
                <rect x="8" y="-18" width="15" height="15" rx="3" />
                <text x="15.5" y="-7">
                  P
                </text>
                <title>Pit lane estimate from recorded event duration</title>
              </g>
              <g
                ref={(element) => {
                  if (element)
                    labelElements.current.set(driver.driverNumber, element)
                  else labelElements.current.delete(driver.driverNumber)
                }}
                className={`race-car-label-group ${driver.driverNumber === selectedDriver?.driverNumber ? 'selected' : ''}`}
                opacity="0"
              >
                <line className="label-leader" />
                <rect
                  x="0"
                  y="-15"
                  width={Math.max(30, driver.nameAcronym.length * 7 + 10)}
                  height="19"
                  rx="4"
                />
                <text x="5" y="-2">
                  {driver.nameAcronym}
                </text>
              </g>
            </g>
          ))}
          <g
            ref={overflowBadgeRef}
            className="driver-group-badge"
            role="button"
            tabIndex={0}
            aria-expanded={overflowOpen}
            aria-label="Show closely grouped drivers"
            display="none"
            onClick={() => setOverflowOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOverflowOpen((open) => !open)
              }
            }}
          >
            <circle r="15" />
            <text x="0" y="4">
              +0
            </text>
          </g>
        </g>
      </svg>
      {overflowOpen && overflowDriverNumbers.length > 0 ? (
        <div
          className="driver-cluster-list"
          role="region"
          aria-label="Closely grouped drivers"
        >
          <div className="driver-cluster-heading">
            <strong>Grouped cars</strong>
            <button
              type="button"
              onClick={() => setOverflowOpen(false)}
              aria-label="Close grouped drivers"
            >
              ×
            </button>
          </div>
          {overflowDriverNumbers.map((number) => {
            const driver = drivers.find((item) => item.driverNumber === number)
            if (!driver) return null
            return (
              <button
                key={number}
                type="button"
                onClick={() => {
                  onSelectDriver(number)
                  setOverflowOpen(false)
                }}
              >
                <i style={{ background: teamColor(driver.teamColour) }} />
                {driver.nameAcronym}
                <span>{driver.fullName}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {(positionsPending || circuitPending || driversPending) && !track ? (
        <div className="track-state">
          <span className="tyre-loader-wheel" style={{ color: '#e8002d' }}>
            <TyreGraphic detailed label="PITLANE" />
          </span>
          <strong>Preparing the circuit</strong>
          <span>
            {circuitPending
              ? 'Loading a stable recorded circuit trace'
              : positionsPending
                ? 'Loading recorded car positions for this session'
                : 'Matching recorded positions to driver metadata'}
          </span>
        </div>
      ) : null}
      {positionsError ? (
        <div className="track-state track-error" role="alert">
          <Activity size={21} />
          <strong>Position feed unavailable</strong>
          <span>{positionsError}</span>
          <Button size="small" variant="secondary" onClick={onRetry}>
            Retry positions
          </Button>
        </div>
      ) : null}
      {positionsEmpty && !track ? (
        <div className="track-state" role="status">
          <Flag size={22} />
          <strong>No recorded position samples</strong>
          <span>
            OpenF1 returned an empty result for this session window. Seek to
            another window when available.
          </span>
        </div>
      ) : null}
      {retiredOnly && !track ? (
        <div className="track-state" role="status">
          <Flag size={22} />
          <strong>No active cars to display</strong>
          <span>
            Drivers who did not start are hidden from the circuit map.
          </span>
        </div>
      ) : null}
      {!positionsPending &&
      !circuitPending &&
      !driversPending &&
      !positionsError &&
      !positionsEmpty &&
      !retiredOnly &&
      !track ? (
        <div className="track-state" role="status">
          <strong>Not enough location samples to draw a circuit</strong>
          <span>
            The selected window contains fewer than two usable position records.
          </span>
        </div>
      ) : null}
      {track ? (
        <p className="track-empty-note" ref={emptyNoteRef} role="status" hidden>
          <strong>No car positions at this moment</strong>
          <span>
            OpenF1 may send no usable location while cars are stationary, for
            example on the grid before lights out. Cars reappear when samples
            resume.
          </span>
        </p>
      ) : null}
      <div className="circuit-caption">
        <span>Local X/Y, fitted without distortion</span>
        <span>
          {pitLaneMissing
            ? 'PIT LANE NOT IN POSITION FEED'
            : 'Amber P marks a car in the pit lane'}
        </span>
        <span>Position data may have gaps over 1.5 s</span>
      </div>
    </section>
  )
}

function ReplayMessage({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <section className="race-replay panel">
      <p className="replay-status" role={retry ? 'alert' : 'status'}>
        {text}
        {retry ? (
          <Button size="small" variant="secondary" onClick={retry}>
            Retry
          </Button>
        ) : null}
      </p>
    </section>
  )
}
