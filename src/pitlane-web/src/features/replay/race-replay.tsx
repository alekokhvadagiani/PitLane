import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Flag,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getCarData,
  getClassification,
  getRacePositions,
  getSessionLaps,
  getSessionDrivers,
  getSessionPitStops,
  getSessionResults,
  getSessionStints,
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
  interpolatePosition,
  finalResultStatus,
  lapAt,
  normalizeCarSamples,
  pitStopVisitAt,
  placeDriverLabels,
  removeSharedStationaryPositions,
  ReplayClock,
  replayStatusAt,
  tyreAtReplayTime,
  telemetryAt,
  type ReplayPoint,
} from '@/features/replay/replay-engine'

const WINDOW_MS = 180_000
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
const MAP_WIDTH = 720
const MAP_HEIGHT = 460

type DriverPath = { driver: HistoricalDriver; points: ReplayPoint[] }

function utc(value: number) {
  return new Date(value).toISOString()
}

function formatClock(value: number) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(value)
}

function formatElapsed(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

type ReplayTimelineEvent = {
  id: string
  timeMs: number
  kind: 'lap' | 'pit-entry' | 'pit-exit' | 'pit-stop'
  label: string
  detail: string
}

function timelineEventsForDriver(
  driverNumber: number | undefined,
  laps: HistoricalLap[],
  pitStops: HistoricalPitStop[],
  startMs: number,
  durationMs: number,
): ReplayTimelineEvent[] {
  if (driverNumber === undefined || durationMs <= 0) return []
  const events: ReplayTimelineEvent[] = []
  for (const lap of laps) {
    if (lap.driverNumber !== driverNumber || !lap.dateStart) continue
    const timeMs = Date.parse(lap.dateStart)
    if (
      !Number.isFinite(timeMs) ||
      (lap.lapNumber === 1 && timeMs - startMs <= 1_000) ||
      timeMs < startMs ||
      timeMs > startMs + durationMs
    )
      continue
    events.push({
      id: `lap-${lap.lapNumber}-${timeMs}`,
      timeMs,
      kind: 'lap',
      label: `Lap ${lap.lapNumber}`,
      detail:
        lap.lapDuration === null
          ? 'Lap boundary'
          : `Lap · ${formatLapTime(lap.lapDuration)}`,
    })
  }
  for (const [index, stop] of pitStops.entries()) {
    if (stop.driverNumber !== driverNumber) continue
    const stopTimeMs = Date.parse(stop.date)
    if (!Number.isFinite(stopTimeMs)) continue
    if (stop.laneDuration !== null && Number.isFinite(stop.laneDuration)) {
      const entryMs = stopTimeMs - stop.laneDuration * 1_000
      if (entryMs >= startMs && entryMs <= startMs + durationMs)
        events.push({
          id: `pit-entry-${stopTimeMs}-${index}`,
          timeMs: entryMs,
          kind: 'pit-entry',
          label: 'Pit lane entry',
          detail: `Estimated entry · lap ${stop.lapNumber ?? 'unknown'}`,
        })
      if (stopTimeMs >= startMs && stopTimeMs <= startMs + durationMs)
        events.push({
          id: `pit-exit-${stopTimeMs}-${index}`,
          timeMs: stopTimeMs,
          kind: 'pit-exit',
          label: 'Pit lane exit',
          detail: `Estimated exit · ${formatPitDuration(stop.laneDuration)}`,
        })
    } else if (stopTimeMs >= startMs && stopTimeMs <= startMs + durationMs) {
      events.push({
        id: `pit-stop-${stopTimeMs}-${index}`,
        timeMs: stopTimeMs,
        kind: 'pit-stop',
        label: 'Pit stop recorded',
        detail: `Pit stop · lap ${stop.lapNumber ?? 'unknown'}`,
      })
    }
  }
  return events.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
}

function clusterTimelineEvents(
  events: ReplayTimelineEvent[],
  durationMs: number,
  width: number,
) {
  const thresholdMs = Math.max(1_000, (durationMs * 24) / Math.max(width, 280))
  const clusters: ReplayTimelineEvent[][] = []
  for (const event of events) {
    const previous = clusters.at(-1)
    if (
      previous &&
      event.timeMs - previous[previous.length - 1].timeMs <= thresholdMs
    )
      previous.push(event)
    else clusters.push([event])
  }
  return clusters
}

function formatPitDuration(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? 'Duration unavailable'
    : `${value.toFixed(1)} s lane time`
}

function formatLapTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

function teamColor(color: string) {
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#aeb7c2'
}

function windowBounds(startMs: number, durationMs: number, index: number) {
  const from = startMs + index * WINDOW_MS
  const to = Math.min(from + WINDOW_MS, startMs + durationMs)
  return from < to ? { fromUtc: utc(from), toUtc: utc(to), fromMs: from } : null
}

type TrackProjection = {
  project: (x: number, y: number) => { x: number; y: number }
}

function createTrackProjection(
  samples: HistoricalPosition[],
): TrackProjection | null {
  const validRows = removeSharedStationaryPositions(samples).filter(
    (row) =>
      row.x !== null &&
      row.y !== null &&
      Number.isFinite(row.x) &&
      Number.isFinite(row.y),
  )
  if (validRows.length < 2) return null
  const minX = Math.min(...validRows.map((row) => row.x!))
  const maxX = Math.max(...validRows.map((row) => row.x!))
  const minY = Math.min(...validRows.map((row) => row.y!))
  const maxY = Math.max(...validRows.map((row) => row.y!))
  const rotate = maxY - minY > (maxX - minX) * 1.22
  const raw = validRows.map((point) => ({
    x: rotate ? point.y! : point.x!,
    y: rotate ? point.x! : point.y!,
  }))
  const lowX = Math.min(...raw.map((point) => point.x))
  const highX = Math.max(...raw.map((point) => point.x))
  const lowY = Math.min(...raw.map((point) => point.y))
  const highY = Math.max(...raw.map((point) => point.y))
  const usableWidth = MAP_WIDTH - 72
  const usableHeight = MAP_HEIGHT - 72
  const scale = Math.min(
    usableWidth / Math.max(highX - lowX, 1),
    usableHeight / Math.max(highY - lowY, 1),
  )
  const offsetX = (MAP_WIDTH - (highX - lowX) * scale) / 2
  const offsetY = (MAP_HEIGHT - (highY - lowY) * scale) / 2
  return {
    project: (x, y) => {
      const projectedX = rotate ? y : x
      const projectedY = rotate ? x : y
      return {
        x: offsetX + (projectedX - lowX) * scale,
        y: offsetY + (highY - projectedY) * scale,
      }
    },
  }
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
    return points.length ? [{ driver, points }] : []
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
  const durationMs = endMs - startMs
  const validDuration = Number.isFinite(durationMs) && durationMs > 0
  const clock = useMemo(
    () => new ReplayClock(startMs, validDuration ? durationMs : 0),
    [durationMs, startMs, validDuration],
  )
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [windowIndex, setWindowIndex] = useState(0)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [classificationIndex, setClassificationIndex] = useState(-1)
  const [timelineWidth, setTimelineWidth] = useState(720)
  const [openEventCluster, setOpenEventCluster] = useState<string | null>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const lapRef = useRef<HTMLSpanElement>(null)
  const timelineLapRef = useRef<HTMLSpanElement>(null)
  const lapTimeRef = useRef<HTMLElement>(null)
  const timelineLapTimeRef = useRef<HTMLElement>(null)
  const timelineProgressRef = useRef<HTMLDivElement>(null)
  const eventCursorRef = useRef<HTMLSpanElement>(null)
  const tyreNodes = useRef(new Map<number, HTMLSpanElement>())
  const statusNodes = useRef(new Map<number, HTMLSpanElement>())
  const selectedTyreRef = useRef<HTMLSpanElement>(null)
  const selectedStatusRef = useRef<HTMLSpanElement>(null)
  const classificationIndexRef = useRef(-1)
  const playStateRef = useRef(false)
  const windowIndexRef = useRef(0)
  const initialSampleSeekApplied = useRef(false)
  const startWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex)
    : null
  const endWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex + 1)
    : null
  // A fixed early-race sample is used only to establish a stable circuit view.
  // Current car positions are still read from the active replay window.
  const circuitWindow = validDuration
    ? windowBounds(startMs, durationMs, 1)
    : null

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
  const sessionLapsQuery = useQuery({
    queryKey: ['historical-session-laps', session.sessionKey],
    queryFn: ({ signal }) => getSessionLaps(session.sessionKey, signal),
    staleTime: STALE_MS,
    gcTime: GC_MS,
    retry: false,
  })
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
  const excludedMapDriverNumbers = useMemo(
    () =>
      new Set(
        finalResults
          .filter((result) => result.dns || result.dnf || result.dsq)
          .map((result) => result.driverNumber),
      ),
    [finalResults],
  )
  const validPositionSamples = useMemo(
    () => removeSharedStationaryPositions(samples),
    [samples],
  )
  const movingSamples = useMemo(
    () =>
      validPositionSamples.filter(
        (sample) => !excludedMapDriverNumbers.has(sample.driverNumber),
      ),
    [excludedMapDriverNumbers, validPositionSamples],
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
    () => createTrackProjection(mapReferenceSamples),
    [mapReferenceSamples],
  )
  const paths = useMemo(
    () => toPaths(movingSamples, drivers, projection),
    [drivers, movingSamples, projection],
  )
  const circuitPaths = useMemo(
    () => toPaths(mapReferenceSamples, drivers, projection),
    [drivers, mapReferenceSamples, projection],
  )
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
  const stints = useMemo(
    () =>
      [...(stintsQuery.data?.items ?? NO_STINTS)].sort(
        (a, b) =>
          a.driverNumber - b.driverNumber || a.stintNumber - b.stintNumber,
      ),
    [stintsQuery.data],
  )
  const pitStops = pitStopsQuery.data?.items ?? NO_PIT_STOPS
  const timelineEvents = useMemo(
    () =>
      timelineEventsForDriver(
        selectedDriver?.driverNumber,
        allLaps,
        pitStops,
        startMs,
        durationMs,
      ),
    [allLaps, durationMs, pitStops, selectedDriver?.driverNumber, startMs],
  )
  const eventClusters = useMemo(
    () => clusterTimelineEvents(timelineEvents, durationMs, timelineWidth),
    [durationMs, timelineEvents, timelineWidth],
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
    const element = timelineRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setTimelineWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => clock.dispose()
  }, [clock])

  useEffect(() => {
    if (
      initialSampleSeekApplied.current ||
      !positions.isSuccess ||
      movingSamples.length === 0 ||
      clock.getSnapshot().elapsedMs !== 0
    )
      return
    const firstSampleMs = Date.parse(movingSamples[0].date)
    if (!Number.isFinite(firstSampleMs)) return
    initialSampleSeekApplied.current = true
    clock.seek(Math.max(0, firstSampleMs - startMs))
  }, [clock, movingSamples, positions.isSuccess, startMs])

  useEffect(() => {
    const unsubscribe = clock.subscribe((snapshot) => {
      if (rangeRef.current) rangeRef.current.value = String(snapshot.elapsedMs)
      if (timeRef.current)
        timeRef.current.textContent = formatClock(snapshot.timestampMs)
      if (elapsedRef.current)
        elapsedRef.current.textContent = formatElapsed(snapshot.elapsedMs)
      const lap = selectedDriver
        ? lapAt(allLaps, selectedDriver.driverNumber, snapshot.timestampMs)
        : null
      if (lapRef.current) {
        lapRef.current.textContent = lap
          ? `Lap ${lap.lapNumber} / ${totalLapsByDriver.get(lap.driverNumber) || '—'}`
          : `${formatElapsed(snapshot.elapsedMs)} elapsed`
      }
      if (timelineLapRef.current)
        timelineLapRef.current.textContent = lap
          ? `LAP ${lap.lapNumber} / ${totalLapsByDriver.get(lap.driverNumber) || '—'}`
          : 'LAP DATA UNAVAILABLE'
      if (lapTimeRef.current)
        lapTimeRef.current.textContent = formatLapTime(lap?.lapDuration)
      if (timelineLapTimeRef.current)
        timelineLapTimeRef.current.textContent = formatLapTime(lap?.lapDuration)
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
        node.textContent = compound ? compound.slice(0, 1) : '—'
        node.dataset.compound = compound
        node.title = compound
          ? `${compound} tyre · ${reading.certainty === 'at-playhead' ? `lap ${driverLap?.lapNumber ?? '—'}` : reading.certainty === 'starting' ? 'starting stint' : 'last reported'} · stint ${stint?.stintNumber ?? '—'}`
          : 'Tyre compound unavailable at this replay time'
      }
      let selectedStatus = 'LOADING'
      let selectedStatusCode = 'loading'
      for (const [driverNumber, node] of statusNodes.current) {
        const result = resultsByDriver.get(driverNumber)
        const status =
          positions.isPending || pitStopsQuery.isPending
            ? 'LOADING'
            : replayStatusAt(
                driverNumber,
                snapshot.timestampMs,
                positionsByDriver.get(driverNumber) ?? NO_POSITIONS,
                pitStops,
                result,
              )
        const finalResult = finalResultStatus(result)
        node.textContent =
          status === 'ON TRACK'
            ? 'TRACK'
            : status === 'PIT LANE'
              ? 'PIT'
              : status === 'DNF'
                ? 'DNF*'
                : status
        node.dataset.status = status.toLowerCase().replaceAll(' ', '-')
        node.dataset.result = finalResult ?? ''
        node.title =
          status === 'DNS'
            ? 'Did not start · final session result'
            : status === 'DNF'
              ? 'DNF in the final classification · OpenF1 does not provide the exact retirement timestamp'
              : status === 'DSQ'
                ? 'Disqualified in the final classification'
                : status === 'PIT LANE'
                  ? 'Inside the recorded pit lane visit interval'
                  : finalResult
                    ? `${status} at playhead · ${finalResult} final result`
                    : `${status} at replay playhead`
        if (selectedDriver?.driverNumber === driverNumber)
          selectedStatusCode = status.toLowerCase().replaceAll(' ', '-')
        if (selectedDriver?.driverNumber === driverNumber)
          selectedStatus =
            status === 'DNS'
              ? 'DNS · DID NOT START'
              : status === 'DNF' || status === 'DSQ'
                ? `${status} · FINAL RESULT`
                : status === 'PIT LANE'
                  ? `PIT LANE · RECORDED VISIT${finalResult ? ` · ${finalResult} FINAL` : ''}`
                  : finalResult
                    ? `${status} · ${finalResult} FINAL`
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
        selectedTyreRef.current.textContent = stintsQuery.isPending
          ? 'Loading'
          : compound
            ? reading?.certainty === 'at-playhead'
              ? compound
              : `${compound} · ${reading?.certainty === 'starting' ? 'STARTING' : 'LAST REPORTED'}`
            : 'Unavailable'
      }
      const width = Math.max(
        0,
        Math.min((snapshot.elapsedMs / durationMs) * 100, 100),
      )
      if (timelineProgressRef.current)
        timelineProgressRef.current.style.width = `${width}%`
      if (eventCursorRef.current)
        eventCursorRef.current.style.left = `${width}%`
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

  return (
    <section className="race-replay panel" aria-label="Race replay">
      <header className="race-replay-heading">
        <div className="race-replay-title">
          <span className="replay-live-state">
            <i /> HISTORICAL REPLAY
          </span>
          <h2>{session.sessionName}</h2>
          <p>
            {driversReady ? `${drivers.length} drivers` : 'Driver data loading'}{' '}
            · OpenF1 recorded positions where available
          </p>
        </div>
        <span className="replay-source">
          {session.sessionType.toUpperCase()} · OPENF1
        </span>
      </header>

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

      <div className="race-replay-workspace">
        <aside className="race-tower" aria-label="Running order">
          <div className="tower-title">
            <span>CLASSIFICATION</span>
            <strong>
              {driversReady ? String(drivers.length).padStart(2, '0') : '—'}
            </strong>
          </div>
          <div className="race-tower-heading">
            <strong>POS</strong>
            <span>DRIVER</span>
            <span>TYRE</span>
            <span>STATUS</span>
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
                {driver.driverNumber === selectedDriver?.driverNumber
                  ? (selectedStint?.compound?.slice(0, 1) ?? '—')
                  : '—'}
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
        />

        <aside className="telemetry-rail" aria-label="Selected car telemetry">
          <div className="telemetry-driver">
            <span
              style={{
                background: selectedDriver
                  ? teamColor(selectedDriver.teamColour)
                  : '#777',
              }}
            />
            <div>
              <small>
                CAR {selectedDriver?.driverNumber ?? '—'} ·{' '}
                {selectedDriver?.teamName ?? '—'}
              </small>
              <strong>{selectedDriver?.fullName ?? 'Select a driver'}</strong>
              <em>{selectedDriver?.nameAcronym ?? '—'}</em>
            </div>
          </div>
          <div className="telemetry-session-state">
            <span>
              STATUS <b ref={selectedStatusRef}>NO DATA</b>
            </span>
            <span>
              TYRE{' '}
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
          <SpeedInstrument samples={telemetrySamples} clock={clock} />
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
              <strong>PIT STOPS</strong>
              <span>
                {pitStopsQuery.isPending
                  ? 'LOADING'
                  : pitStopsQuery.isError
                    ? 'UNAVAILABLE'
                    : `${pitStops.filter((stop) => stop.driverNumber === selectedDriver?.driverNumber).length} RECORDED`}
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
                                  ? `${formatClock(visitStartMs)} ENTRY`
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
          <TelemetryDetails samples={telemetrySamples} clock={clock} />
          <p className="telemetry-footnote">
            Recorded values at the replay timestamp. Tyre compound and final
            classification depend on session coverage.
          </p>
        </aside>
      </div>

      <footer className="race-control-deck" aria-label="Replay controls">
        <div className="race-deck-header">
          <div className="race-deck-timing">
            <div className="race-deck-time-main">
              <span className="race-deck-kicker">SESSION TIME · UTC</span>
              <strong ref={timeRef}>{formatClock(startMs)}</strong>
            </div>
            <div className="race-deck-time-meta">
              <span>
                ELAPSED <b ref={elapsedRef}>0:00</b>
              </span>
              <span>
                DURATION <b>{formatElapsed(durationMs)}</b>
              </span>
              <span ref={timelineLapRef}>LAP —</span>
              <span>
                LAP TIME <b ref={timelineLapTimeRef}>—</b>
              </span>
            </div>
          </div>
          <div className="race-deck-controls">
            <Button
              size="small"
              variant="secondary"
              aria-label="Restart replay"
              onClick={() => {
                clock.pause()
                seek(0)
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </Button>
            <Button
              size="small"
              variant="secondary"
              className="race-skip-control"
              aria-label="Back 10 seconds"
              onClick={() => seek(clock.getSnapshot().elapsedMs - 10_000)}
            >
              <SkipBack size={16} aria-hidden="true" />
              <span>10</span>
            </Button>
            <Button
              size="small"
              variant="default"
              className="race-play-control"
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              disabled={!positions.data?.items.length}
              onClick={() => (playing ? clock.pause() : clock.play())}
            >
              {playing ? (
                <Pause size={20} aria-hidden="true" />
              ) : (
                <Play size={20} aria-hidden="true" />
              )}
            </Button>
            <Button
              size="small"
              variant="secondary"
              className="race-skip-control"
              aria-label="Forward 10 seconds"
              onClick={() => seek(clock.getSnapshot().elapsedMs + 10_000)}
            >
              <SkipForward size={16} aria-hidden="true" />
              <span>10</span>
            </Button>
            <label className="race-speed-control">
              <span>SPEED</span>
              <select
                aria-label="Replay speed"
                value={speed}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSpeed(value)
                  clock.setSpeed(value)
                }}
              >
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="5">5×</option>
                <option value="10">10×</option>
              </select>
            </label>
            <label className="race-lap-jump-control">
              <span>JUMP TO LAP</span>
              <select
                aria-label="Jump to lap"
                defaultValue=""
                disabled={
                  !sessionLapsQuery.isSuccess || availableLapStarts.length === 0
                }
                onChange={(event) => {
                  const lapNumber = Number(event.currentTarget.value)
                  const lap = availableLapStarts.find(
                    (item) => item.lapNumber === lapNumber,
                  )
                  event.currentTarget.value = ''
                  if (lap?.dateStart)
                    seek(Math.max(0, Date.parse(lap.dateStart) - startMs))
                }}
              >
                {sessionLapsQuery.isSuccess && availableLapStarts.length ? (
                  <>
                    <option value="" disabled>
                      SELECT LAP
                    </option>
                    {availableLapStarts.map((lap) => (
                      <option
                        key={`${lap.driverNumber}-${lap.lapNumber}-${lap.dateStart}`}
                        value={lap.lapNumber}
                      >
                        LAP {String(lap.lapNumber).padStart(2, '0')}
                      </option>
                    ))}
                  </>
                ) : !sessionLapsQuery.isSuccess ? (
                  <option value="">
                    {sessionLapsQuery.isPending ? 'LOADING' : 'UNAVAILABLE'}
                  </option>
                ) : (
                  <option value="">NO LAP DATA</option>
                )}
              </select>
            </label>
          </div>
        </div>
        <div className="race-timeline-area">
          <div className="race-timeline-labels">
            <span>SESSION START</span>
            <span>SESSION END</span>
          </div>
          <div className="race-timeline-rail" ref={timelineRef}>
            <div className="race-timeline-base" />
            <div ref={timelineProgressRef} className="race-timeline-progress" />
            <span ref={eventCursorRef} className="race-timeline-playhead" />
            <div
              className="race-timeline-events"
              aria-label="Recorded replay events"
            >
              {eventClusters.map((cluster) => {
                const clusterKey = cluster.map((event) => event.id).join('|')
                const event = cluster[0]
                const position = Math.max(
                  0,
                  Math.min(((event.timeMs - startMs) / durationMs) * 100, 100),
                )
                if (cluster.length === 1)
                  return (
                    <button
                      key={clusterKey}
                      type="button"
                      className={`race-timeline-event ${event.kind}`}
                      style={{ left: `${position}%` }}
                      title={`${event.label} · ${formatElapsed(event.timeMs - startMs)} · ${event.detail}`}
                      aria-label={`Jump to ${event.label}, ${formatElapsed(event.timeMs - startMs)}`}
                      onClick={() => seek(event.timeMs - startMs)}
                    >
                      <span aria-hidden="true">
                        {event.kind === 'lap'
                          ? String(event.label.replace('Lap ', ''))
                          : event.kind === 'pit-entry'
                            ? 'IN'
                            : event.kind === 'pit-exit'
                              ? 'OUT'
                              : 'P'}
                      </span>
                    </button>
                  )
                return (
                  <div
                    className="race-timeline-cluster"
                    key={clusterKey}
                    style={{ left: `${position}%` }}
                  >
                    <button
                      type="button"
                      className="race-timeline-cluster-trigger"
                      title={cluster
                        .map(
                          (item) =>
                            `${item.label} · ${formatElapsed(item.timeMs - startMs)}`,
                        )
                        .join('\n')}
                      aria-label={`${cluster.length} recorded events near ${formatElapsed(event.timeMs - startMs)}`}
                      aria-expanded={openEventCluster === clusterKey}
                      onClick={() =>
                        setOpenEventCluster((open) =>
                          open === clusterKey ? null : clusterKey,
                        )
                      }
                    >
                      {cluster.length}
                    </button>
                    {openEventCluster === clusterKey ? (
                      <div
                        className={`race-timeline-event-menu ${position > 50 ? 'align-right' : 'align-left'}`}
                      >
                        {cluster.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`race-timeline-menu-item ${item.kind}`}
                            onClick={() => {
                              seek(item.timeMs - startMs)
                              setOpenEventCluster(null)
                            }}
                          >
                            <span>{item.label}</span>
                            <small>
                              {formatElapsed(item.timeMs - startMs)} ·{' '}
                              {item.detail}
                            </small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <input
              ref={rangeRef}
              className="race-timeline-scrubber"
              type="range"
              min="0"
              max={durationMs}
              step="1"
              defaultValue="0"
              aria-label="Seek through session replay"
              onInput={(event) => seek(Number(event.currentTarget.value))}
            />
          </div>
          <div className="race-timeline-foot">
            <span>00:00</span>
            <span>
              {eventClusters.length
                ? `${timelineEvents.length} EVENTS`
                : 'RECORDED TIMELINE'}
            </span>
            <span>{formatElapsed(durationMs)}</span>
          </div>
          {timelineEvents.length ? (
            <div className="race-timeline-key" aria-label="Timeline event key">
              {[...new Set(timelineEvents.map((event) => event.kind))].map(
                (kind) => (
                  <span key={kind} className={kind}>
                    <i aria-hidden="true" />
                    {kind === 'lap'
                      ? 'LAP'
                      : kind === 'pit-entry'
                        ? 'PIT IN · EST.'
                        : kind === 'pit-exit'
                          ? 'PIT OUT · EST.'
                          : 'PIT STOP'}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
        {positions.isError ||
        (!positions.isPending && movingSamples.length === 0) ? (
          <p
            className="race-timeline-notice"
            role={positions.isError ? 'alert' : 'status'}
          >
            {positions.isError
              ? 'Recorded car positions could not be loaded. Retry from the circuit panel.'
              : 'No recorded car positions are available in this part of the replay.'}
          </p>
        ) : null}
      </footer>
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
  return (
    <div className={`panel-loader ${compact ? 'compact' : ''}`} role="status">
      <F1Tire />
      <span>{label}…</span>
    </div>
  )
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

function F1Tire() {
  return (
    <svg className="f1-tire" viewBox="0 0 72 72" aria-hidden="true">
      <circle className="tire-outer" cx="36" cy="36" r="31" />
      <circle className="tire-sidewall" cx="36" cy="36" r="24" />
      <circle className="tire-rim" cx="36" cy="36" r="13" />
      <circle className="tire-hub" cx="36" cy="36" r="4" />
      {Array.from({ length: 8 }, (_, index) => (
        <path
          key={index}
          className="tire-tread"
          d="M32 5h8l-2 7h-4z"
          transform={`rotate(${index * 45} 36 36)`}
        />
      ))}
      <path className="tire-mark" d="M35 26l8 9-8 11" />
    </svg>
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
}: {
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
      const placements = placeDriverLabels(
        targets,
        MAP_WIDTH,
        MAP_HEIGHT,
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
  ])

  return (
    <section className="race-track-panel" aria-label="Circuit replay">
      <div className="race-track-topline">
        <div>
          <span className="circuit-live-dot" /> CIRCUIT POSITION <b>OPENF1</b>
        </div>
        <span>
          {track
            ? 'RECORDED TRACE'
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
        className="race-track-map"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
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
        {track?.points[0] ? (
          <g
            className="track-window-start"
            transform={`translate(${track.points[0].x} ${track.points[0].y})`}
            aria-label="Start of loaded position window"
          >
            <circle r="12" />
            <path d="M-3 -9h6v18h-6zM-3 -9h6M-3 -3h6M-3 3h6M-3 9h6" />
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
          <F1Tire />
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
            Drivers classified DNS, DNF, or DSQ are hidden from the circuit map.
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
      <div className="circuit-caption">
        <span>LOCAL X / Y · FITTED WITHOUT DISTORTION</span>
        <span>AMBER P BADGE · ACTIVE PIT LANE VISIT</span>
        <span>POSITION DATA MAY HAVE GAPS OVER 1.5 S</span>
      </div>
    </section>
  )
}

function SpeedInstrument({
  samples,
  clock,
}: {
  samples: HistoricalCarSample[]
  clock: ReplayClock
}) {
  const speedText = useRef<SVGTextElement>(null)
  const rpmText = useRef<SVGTextElement>(null)
  const speedArc = useRef<SVGCircleElement>(null)
  const rpmArc = useRef<SVGCircleElement>(null)
  const speedNeedle = useRef<SVGLineElement>(null)
  const throttleSegments = useRef<HTMLSpanElement[]>([])
  const brakeSegments = useRef<HTMLSpanElement[]>([])
  const throttleText = useRef<HTMLSpanElement>(null)
  const brakeText = useRef<HTMLSpanElement>(null)
  const gearText = useRef<HTMLElement>(null)
  const drsText = useRef<HTMLSpanElement>(null)
  const drsBadge = useRef<HTMLDivElement>(null)
  const sampleStatus = useRef<HTMLElement>(null)
  const instrumentSvg = useRef<SVGSVGElement>(null)
  const speedArcLength = 75
  const rpmArcLength = 72
  const setSegment = (segments: HTMLSpanElement[], amount: number | null) => {
    const active =
      amount === null ? -1 : Math.ceil(Math.max(0, Math.min(amount, 100)) / 10)
    segments.forEach((segment, index) =>
      segment.toggleAttribute('data-active', index < active),
    )
  }

  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        const telemetry = telemetryAt(samples, timestampMs)
        if (instrumentSvg.current) {
          instrumentSvg.current.setAttribute(
            'aria-label',
            `Recorded speed ${telemetry?.speed == null ? 'unavailable' : Math.round(telemetry.speed)} kilometers per hour, throttle ${telemetry?.throttle == null ? 'unavailable' : Math.round(telemetry.throttle)} percent`,
          )
        }
        if (sampleStatus.current)
          sampleStatus.current.textContent = telemetry
            ? `SAMPLE ${Math.max(0, (timestampMs - Date.parse(telemetry.date)) / 1_000).toFixed(1)}s`
            : 'NO SAMPLE'
        if (speedText.current)
          speedText.current.textContent =
            telemetry?.speed == null ? '—' : String(Math.round(telemetry.speed))
        if (rpmText.current)
          rpmText.current.textContent =
            telemetry?.rpm == null
              ? '—'
              : Math.round(telemetry.rpm).toLocaleString()
        if (speedArc.current) {
          const progress =
            telemetry?.speed == null
              ? 0
              : speedArcLength * Math.max(0, Math.min(telemetry.speed / 360, 1))
          speedArc.current.style.strokeDasharray = `${progress} ${100 - progress}`
          speedArc.current.style.strokeDashoffset = '0'
          speedArc.current.style.opacity = telemetry?.speed == null ? '0' : '1'
        }
        if (speedNeedle.current) {
          const value =
            telemetry?.speed == null
              ? null
              : Math.max(0, Math.min(telemetry.speed / 360, 1))
          speedNeedle.current.style.opacity = value === null ? '0' : '1'
          speedNeedle.current.setAttribute(
            'transform',
            `rotate(${value === null ? 225 : 225 + value * 270} 200 201)`,
          )
        }
        if (rpmArc.current) {
          const progress =
            telemetry?.rpm == null
              ? 0
              : rpmArcLength * Math.max(0, Math.min(telemetry.rpm / 15000, 1))
          rpmArc.current.style.strokeDasharray = `${progress} ${100 - progress}`
          rpmArc.current.style.strokeDashoffset = '0'
          rpmArc.current.style.opacity = telemetry?.rpm == null ? '0' : '1'
        }
        setSegment(throttleSegments.current, telemetry?.throttle ?? null)
        setSegment(
          brakeSegments.current,
          telemetry?.brake == null ? null : telemetry.brake > 0 ? 100 : 0,
        )
        if (throttleText.current)
          throttleText.current.textContent =
            telemetry?.throttle == null
              ? '—'
              : `${Math.round(telemetry.throttle)}%`
        if (brakeText.current)
          brakeText.current.textContent =
            telemetry?.brake == null ? '—' : telemetry.brake > 0 ? 'ON' : 'OFF'
        if (gearText.current)
          gearText.current.textContent =
            telemetry?.gear == null ? '—' : String(telemetry.gear)
        if (drsText.current)
          drsText.current.textContent =
            telemetry?.drs == null
              ? 'UNAVAILABLE'
              : [10, 12, 14].includes(telemetry.drs)
                ? 'ACTIVE'
                : 'INACTIVE'
        if (drsBadge.current)
          drsBadge.current.dataset.state =
            telemetry?.drs == null
              ? 'unavailable'
              : [10, 12, 14].includes(telemetry.drs)
                ? 'active'
                : 'inactive'
      }),
    [clock, samples, speedArcLength, rpmArcLength],
  )

  return (
    <div className="speed-instrument">
      <div className="instrument-heading">
        <span>CAR TELEMETRY</span>
        <b ref={sampleStatus}>NO SAMPLE</b>
      </div>
      <svg
        ref={instrumentSvg}
        viewBox="0 0 400 400"
        role="img"
        aria-label="Recorded speed unavailable kilometers per hour, throttle unavailable percent"
      >
        <defs>
          <radialGradient id="instrument-face">
            <stop offset="0" stopColor="#151a20" />
            <stop offset="0.78" stopColor="#090c10" />
            <stop offset="1" stopColor="#11161d" />
          </radialGradient>
          <filter id="speed-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle className="gauge-face" cx="200" cy="201" r="178" />
        <circle className="gauge-bezel" cx="200" cy="201" r="180" />
        <circle
          className="gauge-rail"
          pathLength="100"
          cx="200"
          cy="201"
          r="164"
          transform="rotate(135 200 201)"
          strokeDasharray="75 25"
        />
        <circle
          className="gauge-rail"
          pathLength="100"
          cx="200"
          cy="201"
          r="150"
          transform="rotate(135 200 201)"
          strokeDasharray="75 25"
        />
        <circle
          ref={speedArc}
          className="gauge-speed"
          pathLength="100"
          cx="200"
          cy="201"
          r="150"
          transform="rotate(135 200 201)"
          strokeDasharray="0 100"
          strokeDashoffset="0"
        />
        {Array.from({ length: 37 }, (_, index) => {
          const angle = ((135 + index * (270 / 36)) * Math.PI) / 180
          const major = index % 6 === 0
          const inner = major ? 128 : index % 3 === 0 ? 132 : 136
          const outer = 145
          const x1 = 200 + Math.cos(angle) * inner
          const y1 = 201 + Math.sin(angle) * inner
          const x2 = 200 + Math.cos(angle) * outer
          const y2 = 201 + Math.sin(angle) * outer
          const value = index * 10
          const lx = 200 + Math.cos(angle) * 113
          const ly = 201 + Math.sin(angle) * 113 + 5
          return (
            <g key={index}>
              <line
                className={major ? 'gauge-tick major' : 'gauge-tick'}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              />
              {major ? (
                <text className="gauge-scale-label" x={lx} y={ly}>
                  {value === 360 ? '360' : value}
                </text>
              ) : null}
            </g>
          )
        })}
        <line
          ref={speedNeedle}
          className="gauge-needle"
          x1="200"
          y1="201"
          x2="200"
          y2="60"
        />
        <circle className="gauge-hub" cx="200" cy="201" r="7" />
        <circle
          className="gauge-rpm-rail"
          pathLength="100"
          cx="200"
          cy="201"
          r="88"
          transform="rotate(135 200 201)"
          strokeDasharray="72 28"
        />
        {Array.from({ length: 16 }, (_, index) => {
          const angle = ((135 + index * (270 / 15)) * Math.PI) / 180
          const major = index % 4 === 0 || index === 15
          const x1 = 200 + Math.cos(angle) * (major ? 96 : 98)
          const y1 = 201 + Math.sin(angle) * (major ? 96 : 98)
          const x2 = 200 + Math.cos(angle) * 104
          const y2 = 201 + Math.sin(angle) * 104
          const label = index === 15 ? '15' : String(index)
          const lx = 200 + Math.cos(angle) * 108
          const ly = 201 + Math.sin(angle) * 108 + 3
          return (
            <g key={`rpm-${index}`}>
              <line
                className={major ? 'rpm-tick major' : 'rpm-tick'}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              />
              {major ? (
                <text className="rpm-scale-label" x={lx} y={ly}>
                  {label}
                </text>
              ) : null}
            </g>
          )
        })}
        <circle
          ref={rpmArc}
          className="gauge-rpm-arc"
          pathLength="100"
          cx="200"
          cy="201"
          r="88"
          transform="rotate(135 200 201)"
          strokeDasharray="0 100"
          strokeDashoffset="0"
        />
        <circle className="gauge-inner-face" cx="200" cy="201" r="73" />
        <text ref={speedText} className="gauge-speed-number" x="200" y="207">
          —
        </text>
        <text className="gauge-speed-unit" x="200" y="230">
          KM/H
        </text>
        <text ref={rpmText} className="gauge-rpm-number" x="200" y="313">
          —
        </text>
        <text className="gauge-rpm-label" x="200" y="329">
          RPM
        </text>
        <text className="gauge-center-caption" x="200" y="261">
          ENGINE
        </text>
        <text className="gauge-arc-label" x="200" y="25">
          SPEED · KM/H
        </text>
      </svg>
      <div className="gauge-bottom-row">
        <div
          className="pedal-gauge throttle-gauge"
          aria-label="Throttle, percent from 0 to 100"
        >
          <div className="pedal-segments">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                ref={(node) => {
                  if (node) throttleSegments.current[i] = node
                }}
              />
            ))}
          </div>
          <div className="pedal-label">
            <span>THROTTLE</span>
            <b ref={throttleText}>—</b>
          </div>
          <small>0–100%</small>
        </div>
        <div className="gear-plinth">
          <span>GEAR</span>
          <b ref={gearText}>—</b>
        </div>
        <div className="pedal-gauge brake-gauge" aria-label="Brake state">
          <div className="pedal-segments">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                ref={(node) => {
                  if (node) brakeSegments.current[i] = node
                }}
              />
            ))}
          </div>
          <div className="pedal-label">
            <span>BRAKE</span>
            <b ref={brakeText}>—</b>
          </div>
          <small>RECORDED STATE</small>
        </div>
      </div>
      <div className="drs-readout" ref={drsBadge} data-state="unavailable">
        <span>DRS</span>
        <b ref={drsText}>UNAVAILABLE</b>
      </div>
    </div>
  )
}

function TelemetryDetails({
  samples,
  clock,
}: {
  samples: HistoricalCarSample[]
  clock: ReplayClock
}) {
  const throttle = useRef<HTMLElement>(null)
  const brake = useRef<HTMLElement>(null)
  const sampleAge = useRef<HTMLElement>(null)
  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        const item = telemetryAt(samples, timestampMs)
        if (throttle.current)
          throttle.current.textContent =
            item?.throttle == null ? '—' : `${Math.round(item.throttle)}%`
        if (brake.current)
          brake.current.textContent =
            item?.brake == null ? '—' : item.brake > 0 ? 'ON' : 'OFF'
        if (sampleAge.current)
          sampleAge.current.textContent = item
            ? `${Math.max(0, (timestampMs - Date.parse(item.date)) / 1_000).toFixed(1)}s`
            : '—'
      }),
    [clock, samples],
  )
  return (
    <div className="telemetry-grid">
      <TelemetryValue label="Throttle" ref={throttle} />
      <TelemetryValue label="Brake" ref={brake} />
      <TelemetryValue label="Sample age" ref={sampleAge} />
    </div>
  )
}

function TelemetryValue({
  label,
  value,
  ref,
}: {
  label: string
  value?: string
  ref?: Ref<HTMLElement>
}) {
  return (
    <div className="telemetry-value">
      <span>{label}</span>
      <strong ref={ref}>{value ?? '—'}</strong>
    </div>
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
