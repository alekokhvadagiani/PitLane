import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getCarData,
  getClassification,
  getDriverLaps,
  getRacePositions,
  getSessionDrivers,
  type HistoricalCarSample,
  type HistoricalClassificationChange,
  type HistoricalDriver,
  type HistoricalLap,
  type HistoricalPosition,
  type RaceSession,
} from '@/lib/api'

const WINDOW_MS = 180_000
const MAX_GAP_MS = 1_500
const REFRESH_MS = 200
const NO_DRIVERS: HistoricalDriver[] = []
const NO_POSITIONS: HistoricalPosition[] = []
const NO_CLASSIFICATION: HistoricalClassificationChange[] = []

type Point = { x: number; y: number; dateMs: number }
type DriverPath = { driver: HistoricalDriver; points: Point[] }

function utc(value: number) {
  return new Date(value).toISOString()
}

function formatClock(value: number) {
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

function teamColor(color: string) {
  return /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : '#aeb7c2'
}

function windowBounds(startMs: number, durationMs: number, index: number) {
  const from = startMs + index * WINDOW_MS
  const to = Math.min(from + WINDOW_MS, startMs + durationMs)
  return from < to ? { fromUtc: utc(from), toUtc: utc(to), fromMs: from } : null
}

function toPaths(samples: HistoricalPosition[], drivers: HistoricalDriver[]) {
  const byNumber = new Map<number, Point[]>()
  for (const sample of samples) {
    if (sample.x === null || sample.y === null) continue
    const dateMs = Date.parse(sample.date)
    if (!Number.isFinite(dateMs)) continue
    const points = byNumber.get(sample.driverNumber) ?? []
    points.push({ x: sample.x, y: sample.y, dateMs })
    byNumber.set(sample.driverNumber, points)
  }

  const allPoints = [...byNumber.values()].flat()
  if (allPoints.length === 0) return []
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of allPoints) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const scale = Math.min(
    420 / Math.max(maxX - minX, 1),
    290 / Math.max(maxY - minY, 1),
  )
  const offsetX = (420 - (maxX - minX) * scale) / 2
  const offsetY = (290 - (maxY - minY) * scale) / 2
  const driversByNumber = new Map(
    drivers.map((driver) => [driver.driverNumber, driver]),
  )
  return [...byNumber.entries()].flatMap(([driverNumber, points]) => {
    points.sort((a, b) => a.dateMs - b.dateMs)
    const driver = driversByNumber.get(driverNumber)
    if (!driver) return []
    const mapped = points.map((point) => ({
      x: 40 + offsetX + (point.x - minX) * scale,
      y: 35 + offsetY + (maxY - point.y) * scale,
      dateMs: point.dateMs,
    }))
    return [{ driver, points: mapped }]
  })
}

function pathSegments(points: Point[]) {
  const segments: string[] = []
  let segment: Point[] = []
  for (const point of points) {
    const previous = segment.at(-1)
    if (previous && point.dateMs - previous.dateMs > MAX_GAP_MS) {
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

function pointAt(points: Point[], dateMs: number) {
  let low = 0
  let high = points.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (points[mid].dateMs < dateMs) low = mid + 1
    else high = mid
  }
  const right = points[low]
  const left = points[low - 1]
  if (!right) return null
  if (!left) return Math.abs(right.dateMs - dateMs) <= MAX_GAP_MS ? right : null
  const gap = right.dateMs - left.dateMs
  if (gap <= 0 || gap > MAX_GAP_MS || dateMs < left.dateMs) return null
  const mix = (dateMs - left.dateMs) / gap
  return {
    x: left.x + (right.x - left.x) * mix,
    y: left.y + (right.y - left.y) * mix,
  }
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

function latestCarSample(samples: HistoricalCarSample[], dateMs: number) {
  let low = 0
  let high = samples.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (Date.parse(samples[mid].date) <= dateMs) low = mid + 1
    else high = mid
  }
  const sample = samples[low - 1]
  return sample && dateMs - Date.parse(sample.date) <= 3_000 ? sample : null
}

function currentLapAt(laps: HistoricalLap[], dateMs: number) {
  let current: HistoricalLap | null = null
  for (const lap of laps) {
    if (!lap.dateStart || Date.parse(lap.dateStart) > dateMs) continue
    if (!current || Date.parse(lap.dateStart) > Date.parse(current.dateStart!))
      current = lap
  }
  return current
}

function formatLapTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

export function RaceReplay({ session }: { session: RaceSession }) {
  const driversQuery = useQuery({
    queryKey: ['historical-drivers', session.sessionKey],
    queryFn: ({ signal }) => getSessionDrivers(session.sessionKey, signal),
    staleTime: 30 * 60_000,
    retry: false,
  })
  const classification = useQuery({
    queryKey: ['historical-classification', session.sessionKey],
    queryFn: ({ signal }) => getClassification(session.sessionKey, signal),
    staleTime: 30 * 60_000,
    retry: false,
  })
  const startMs = Date.parse(session.dateStart)
  const endMs = session.dateEnd ? Date.parse(session.dateEnd) : NaN
  const durationMs = endMs - startMs
  const validDuration = Number.isFinite(durationMs) && durationMs > 0
  const [elapsedMs, setElapsedMs] = useState(0)
  const [windowIndex, setWindowIndex] = useState(0)
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [displayDateMs, setDisplayDateMs] = useState(startMs)
  const clockRef = useRef(0)
  const rangeRef = useRef<HTMLInputElement>(null)
  const startWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex)
    : null
  const endWindow = validDuration
    ? windowBounds(startMs, durationMs, windowIndex + 1)
    : null
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
    staleTime: 30 * 60_000,
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
    staleTime: 30 * 60_000,
    retry: false,
  })
  const drivers = driversQuery.data?.items ?? NO_DRIVERS
  const selectedDriver =
    drivers.find((driver) => driver.driverNumber === selectedNumber) ??
    drivers[0]
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
    staleTime: 30 * 60_000,
    retry: false,
  })
  const driverLaps = useQuery({
    queryKey: [
      'historical-laps',
      session.sessionKey,
      selectedDriver?.driverNumber,
    ],
    queryFn: ({ signal }) =>
      getDriverLaps(session.sessionKey, selectedDriver!.driverNumber, signal),
    enabled: selectedDriver !== undefined,
    staleTime: 30 * 60_000,
    retry: false,
  })
  const samples = positions.data?.items ?? NO_POSITIONS
  const paths = useMemo(() => toPaths(samples, drivers), [samples, drivers])
  const changes = classification.data?.items ?? NO_CLASSIFICATION
  const orderedDrivers = useMemo(
    () => currentOrder(drivers, changes, displayDateMs),
    [drivers, changes, displayDateMs],
  )
  const telemetry = latestCarSample(carData.data?.items ?? [], displayDateMs)
  const laps = driverLaps.data?.items ?? []
  const currentLap = currentLapAt(laps, displayDateMs)
  const totalLaps = laps.reduce(
    (maximum, lap) => Math.max(maximum, lap.lapNumber),
    0,
  )

  const seek = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(value, durationMs))
      clockRef.current = next
      setElapsedMs(next)
      setWindowIndex(Math.floor(next / WINDOW_MS))
      setDisplayDateMs(startMs + next)
      if (rangeRef.current) rangeRef.current.value = String(next)
    },
    [durationMs, startMs],
  )

  useEffect(() => {
    if (!playing || !validDuration) return
    let frame = 0
    let previous = performance.now()
    let lastDisplay = previous
    const tick = (now: number) => {
      const next = clockRef.current + (now - previous) * speed
      previous = now
      if (next >= durationMs) {
        seek(durationMs)
        setPlaying(false)
        return
      }
      clockRef.current = next
      const nextWindow = Math.floor(next / WINDOW_MS)
      setWindowIndex((current) =>
        current === nextWindow ? current : nextWindow,
      )
      if (rangeRef.current) rangeRef.current.value = String(next)
      if (now - lastDisplay >= REFRESH_MS) {
        setElapsedMs(next)
        setDisplayDateMs(startMs + next)
        lastDisplay = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, durationMs, validDuration, seek, startMs])

  if (driversQuery.isPending)
    return <ReplayMessage text="Loading session replay data…" />
  if (driversQuery.isError)
    return (
      <ReplayMessage
        text={driversQuery.error.message}
        retry={() => void driversQuery.refetch()}
      />
    )
  if (!validDuration)
    return (
      <ReplayMessage text="OpenF1 did not provide valid session start and end times, so this session cannot be replayed across its full duration." />
    )
  if (drivers.length === 0)
    return <ReplayMessage text="OpenF1 lists no drivers for this session." />

  return (
    <section className="race-replay panel" aria-label="Race replay">
      <header className="race-replay-heading">
        <div>
          <span className="replay-live-state">
            <i /> RECORDED SESSION
          </span>
          <h2>{session.sessionName}</h2>
          <p>
            {drivers.length} listed drivers · OpenF1 timing and location where
            available
          </p>
        </div>
        <span className="replay-source">OPENF1 · HISTORICAL</span>
      </header>

      <div className="race-replay-workspace">
        <aside className="race-tower" aria-label="Running order">
          <div className="race-tower-heading">
            <strong>Pos</strong>
            <span>Driver</span>
            <span>Team</span>
          </div>
          {classification.isError ? (
            <p className="race-data-note">{classification.error.message}</p>
          ) : null}
          {classification.isPending ? (
            <p className="race-data-note">Loading recorded running order…</p>
          ) : null}
          {orderedDrivers.map(({ driver, position }) => (
            <button
              key={driver.driverNumber}
              type="button"
              className={`race-driver-row ${selectedDriver?.driverNumber === driver.driverNumber ? 'selected' : ''}`}
              onClick={() => setSelectedNumber(driver.driverNumber)}
              aria-pressed={
                selectedDriver?.driverNumber === driver.driverNumber
              }
            >
              <strong className="race-driver-position">
                {position ?? '—'}
              </strong>
              <span
                className="race-driver-acronym"
                style={{ borderColor: teamColor(driver.teamColour) }}
              >
                {driver.nameAcronym}
              </span>
              <span className="race-driver-team">{driver.teamName}</span>
            </button>
          ))}
          {classification.data && classification.data.items.length === 0 ? (
            <p className="race-data-note">
              OpenF1 has no classification changes for this session.
            </p>
          ) : null}
        </aside>

        <TrackMap
          paths={paths}
          selectedDriver={selectedDriver}
          clockRef={clockRef}
          sessionStartMs={startMs}
          samples={samples}
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
                CAR {selectedDriver?.driverNumber ?? '—'} /{' '}
                {selectedDriver?.teamName ?? '—'}
              </small>
              <strong>{selectedDriver?.nameAcronym ?? '—'}</strong>
            </div>
          </div>
          {carData.isError ? (
            <p className="race-data-note" role="alert">
              {carData.error.message}
            </p>
          ) : null}
          {carData.isPending ? (
            <p className="race-data-note" role="status">
              Loading car data…
            </p>
          ) : null}
          {carData.isSuccess && carData.data.items.length === 0 ? (
            <p className="race-data-note">No telemetry samples at this time.</p>
          ) : null}
          <SpeedInstrument telemetry={telemetry} />
          <div className="telemetry-lap-line">
            <span>
              Lap {currentLap?.lapNumber ?? '—'}
              {totalLaps > 0 ? ` / ${totalLaps}` : ''}
            </span>
            <strong>{formatLapTime(currentLap?.lapDuration)}</strong>
          </div>
          <div className="telemetry-grid">
            <TelemetryValue label="Gear" value={telemetry?.gear ?? null} />
            <TelemetryValue
              label="RPM"
              value={telemetry?.rpm?.toLocaleString() ?? null}
            />
            <TelemetryValue
              label="Throttle"
              value={
                telemetry?.throttle == null ? null : `${telemetry.throttle}%`
              }
            />
            <TelemetryValue
              label="Brake"
              value={
                telemetry?.brake == null
                  ? null
                  : telemetry.brake > 0
                    ? 'ON'
                    : 'OFF'
              }
            />
            <TelemetryValue
              label="DRS"
              value={
                telemetry?.drs == null
                  ? null
                  : [10, 12, 14].includes(telemetry.drs)
                    ? 'OPEN'
                    : 'CLOSED'
              }
            />
            <TelemetryValue label="Tyre" value={null} />
            <TelemetryValue
              label="Sample"
              value={
                telemetry
                  ? `${Math.max(0, (displayDateMs - Date.parse(telemetry.date)) / 1_000).toFixed(1)}s`
                  : null
              }
            />
          </div>
          <p className="telemetry-footnote">
            Readings from the nearest recorded sample, up to 3 seconds old.
          </p>
        </aside>
      </div>

      <footer className="race-transport">
        <div className="race-transport-clock">
          <strong>{formatClock(displayDateMs)}</strong>
          <span>
            {currentLap
              ? `Lap ${currentLap.lapNumber} / ${totalLaps || '—'}`
              : `${formatElapsed(elapsedMs)} elapsed`}
          </span>
        </div>
        <div className="race-transport-controls">
          <Button
            size="small"
            variant="secondary"
            aria-label="Restart replay"
            onClick={() => {
              setPlaying(false)
              seek(0)
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </Button>
          <Button
            size="small"
            variant="secondary"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            disabled={samples.length < 2}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </Button>
          <label className="race-speed">
            Speed
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              <option value="0.5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
              <option value="8">8×</option>
            </select>
          </label>
        </div>
        <label className="race-seek-label">
          <span className="sr-only">Seek through replay</span>
          <input
            ref={rangeRef}
            type="range"
            min="0"
            max={durationMs}
            step="1"
            defaultValue="0"
            onInput={(event) => seek(Number(event.currentTarget.value))}
          />
          <span>
            <span>SESSION START</span>
            <span>{formatElapsed(durationMs)}</span>
          </span>
        </label>
        <div className="race-event-track" aria-label="Lap and pit-out timeline">
          <div
            className="race-event-progress"
            style={{
              width: `${Math.max(0, Math.min((elapsedMs / durationMs) * 100, 100))}%`,
            }}
          />
          {laps
            .filter((lap) => lap.isPitOutLap && lap.dateStart)
            .map((lap) => {
              const position =
                ((Date.parse(lap.dateStart!) - startMs) / durationMs) * 100
              return (
                <i
                  key={`pit-${lap.lapNumber}`}
                  className="pit-event-marker"
                  style={{ left: `${Math.max(0, Math.min(position, 100))}%` }}
                  title={`Pit-out lap ${lap.lapNumber}`}
                />
              )
            })}
          <span
            className="race-event-cursor"
            style={{
              left: `${Math.max(0, Math.min((elapsedMs / durationMs) * 100, 100))}%`,
            }}
          />
        </div>
        <div className="race-event-legend">
          <span>
            <i className="event-current" /> PLAYHEAD
          </span>
          <span>
            <i className="event-pit" /> PIT-OUT LAP
          </span>
          <span>Flags & radio are not available in this replay</span>
        </div>
        <p className="race-coverage">
          {positions.isError
            ? positions.error.message
            : samples.length
              ? `${samples.length.toLocaleString()} position samples in this window`
              : positions.isPending
                ? 'Loading position window…'
                : 'No position samples returned for this window'}{' '}
          · requests are limited to 3 minutes
        </p>
      </footer>
    </section>
  )
}

function TrackMap({
  paths,
  selectedDriver,
  clockRef,
  sessionStartMs,
  samples,
  onSelectDriver,
}: {
  paths: DriverPath[]
  selectedDriver?: HistoricalDriver
  clockRef: RefObject<number>
  sessionStartMs: number
  samples: HistoricalPosition[]
  onSelectDriver: (driverNumber: number) => void
}) {
  const circles = useRef(new Map<number, SVGCircleElement>())
  const hitAreas = useRef(new Map<number, SVGCircleElement>())
  const rings = useRef(new Map<number, SVGCircleElement>())
  const labels = useRef(new Map<number, SVGTextElement>())
  const pathsByDriver = useMemo(
    () => new Map(paths.map((path) => [path.driver.driverNumber, path])),
    [paths],
  )
  const pathElements = useMemo(
    () =>
      paths.flatMap(({ driver, points }) =>
        pathSegments(points).map((path, index) => (
          <polyline
            key={`${driver.driverNumber}-${index}`}
            points={path}
            className="race-track-line"
          />
        )),
      ),
    [paths],
  )
  const dotDrivers = useMemo(
    () => [...pathsByDriver.values()].map(({ driver }) => driver),
    [pathsByDriver],
  )

  useEffect(() => {
    let frameId = 0
    const frame = () => {
      const dateMs = sessionStartMs + clockRef.current
      for (const driver of dotDrivers) {
        const element = circles.current.get(driver.driverNumber)
        const hitArea = hitAreas.current.get(driver.driverNumber)
        const ring = rings.current.get(driver.driverNumber)
        const label = labels.current.get(driver.driverNumber)
        if (!element || !hitArea || !ring) continue
        const path = pathsByDriver.get(driver.driverNumber)
        const point = path ? pointAt(path.points, dateMs) : null
        element.style.opacity = point ? '1' : '0'
        ring.style.opacity =
          point && driver.driverNumber === selectedDriver?.driverNumber
            ? '1'
            : '0'
        if (label) label.style.opacity = point ? '1' : '0'
        if (point) {
          element.setAttribute('cx', point.x.toFixed(1))
          element.setAttribute('cy', point.y.toFixed(1))
          hitArea.setAttribute('cx', point.x.toFixed(1))
          hitArea.setAttribute('cy', point.y.toFixed(1))
          ring.setAttribute('cx', point.x.toFixed(1))
          ring.setAttribute('cy', point.y.toFixed(1))
          if (label) {
            label.setAttribute('x', (point.x + 8).toFixed(1))
            label.setAttribute('y', (point.y - 7).toFixed(1))
          }
        }
      }
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(frameId)
  }, [
    clockRef,
    dotDrivers,
    pathsByDriver,
    selectedDriver?.driverNumber,
    sessionStartMs,
  ])

  return (
    <div className="race-track-panel">
      <div className="race-track-topline">
        <span>Circuit position</span>
        <span>
          {samples.length
            ? `${new Set(samples.map((item) => item.driverNumber)).size} cars visible`
            : 'Waiting for location data'}
        </span>
      </div>
      <svg
        className="race-track-map"
        viewBox="0 0 500 350"
        role="group"
        aria-label="Circuit map with interactive recorded car positions"
      >
        <rect
          x="0.5"
          y="0.5"
          width="499"
          height="349"
          className="race-track-frame"
        />
        {pathElements}
        {dotDrivers.map((driver) => (
          <g
            key={driver.driverNumber}
            role="button"
            tabIndex={0}
            aria-label={`Select ${driver.fullName} on circuit`}
            aria-pressed={driver.driverNumber === selectedDriver?.driverNumber}
            onClick={() => onSelectDriver(driver.driverNumber)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectDriver(driver.driverNumber)
              }
            }}
            className="race-car-hit-target"
          >
            <circle
              ref={(element) => {
                if (element) hitAreas.current.set(driver.driverNumber, element)
                else hitAreas.current.delete(driver.driverNumber)
              }}
              r="11"
              fill="transparent"
              pointerEvents="all"
            />
            <circle
              ref={(element) => {
                if (element) circles.current.set(driver.driverNumber, element)
                else circles.current.delete(driver.driverNumber)
              }}
              r={
                driver.driverNumber === selectedDriver?.driverNumber ? 4.5 : 3.1
              }
              className="race-car-dot"
              style={{ fill: teamColor(driver.teamColour) }}
              opacity="0"
            />
            <circle
              ref={(element) => {
                if (element) rings.current.set(driver.driverNumber, element)
                else rings.current.delete(driver.driverNumber)
              }}
              r="8.5"
              className="race-car-ring"
              opacity="0"
            />
            <text
              ref={(element) => {
                if (element) labels.current.set(driver.driverNumber, element)
                else labels.current.delete(driver.driverNumber)
              }}
              className="race-car-label"
              opacity="0"
            >
              {driver.nameAcronym}
            </text>
          </g>
        ))}
      </svg>
      {samples.length === 0 ? (
        <div className="track-no-data" role="status">
          No recorded car positions at this point. Try another point in the
          session.
        </div>
      ) : null}
      <p className="race-map-note">
        OpenF1 local X/Y · interpolated between samples up to 1.5s apart ·
        approximate circuit coordinates
      </p>
    </div>
  )
}

function TelemetryValue({
  label,
  value,
}: {
  label: string
  value: string | number | null
}) {
  return (
    <div className="telemetry-value">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  )
}

function SpeedInstrument({
  telemetry,
}: {
  telemetry: HistoricalCarSample | null
}) {
  const radius = 70
  const circumference = 2 * Math.PI * radius
  const arc = circumference * (260 / 360)
  const throttleRadius = 54
  const throttleCircumference = 2 * Math.PI * throttleRadius
  const throttleArc = throttleCircumference * (260 / 360)
  const speedProgress = Math.max(0, Math.min((telemetry?.speed ?? 0) / 360, 1))
  const throttleProgress = Math.max(
    0,
    Math.min((telemetry?.throttle ?? 0) / 100, 1),
  )

  return (
    <div className="speed-instrument">
      <svg
        viewBox="0 0 200 180"
        role="img"
        aria-label={`Recorded speed ${telemetry?.speed ?? 'unavailable'} kilometers per hour, throttle ${telemetry?.throttle ?? 'unavailable'} percent`}
      >
        <circle
          className="gauge-rail"
          cx="100"
          cy="88"
          r={radius}
          transform="rotate(135 100 88)"
          strokeDasharray={`${arc} ${circumference}`}
        />
        <circle
          className="gauge-speed"
          cx="100"
          cy="88"
          r={radius}
          transform="rotate(135 100 88)"
          strokeDasharray={`${arc} ${circumference}`}
          strokeDashoffset={arc * (1 - speedProgress)}
        />
        <circle
          className="gauge-throttle-rail"
          cx="100"
          cy="88"
          r={throttleRadius}
          transform="rotate(135 100 88)"
          strokeDasharray={`${throttleArc} ${throttleCircumference}`}
        />
        <circle
          className="gauge-throttle"
          cx="100"
          cy="88"
          r={throttleRadius}
          transform="rotate(135 100 88)"
          strokeDasharray={`${throttleArc} ${throttleCircumference}`}
          strokeDashoffset={throttleArc * (1 - throttleProgress)}
        />
        <text className="gauge-speed-number" x="100" y="83">
          {telemetry?.speed ?? '—'}
        </text>
        <text className="gauge-speed-unit" x="100" y="101">
          KM/H
        </text>
        <text className="gauge-rpm-number" x="100" y="123">
          {telemetry?.rpm?.toLocaleString() ?? '—'}
        </text>
        <text className="gauge-rpm-label" x="100" y="137">
          RPM
        </text>
      </svg>
      <div className="gauge-readout-row">
        <span>
          <i className="throttle-key" /> THROTTLE{' '}
          <b>{telemetry?.throttle == null ? '—' : `${telemetry.throttle}%`}</b>
        </span>
        <span className={telemetry?.brake ? 'brake-active' : ''}>
          <i className="brake-key" /> BRAKE{' '}
          <b>
            {telemetry?.brake == null
              ? '—'
              : telemetry.brake > 0
                ? 'ON'
                : 'OFF'}
          </b>
        </span>
      </div>
      <div className="gauge-bottom-row">
        <span className="gear-readout">
          GEAR <b>{telemetry?.gear ?? '—'}</b>
        </span>
        <span
          className={`drs-readout ${telemetry?.drs != null && [10, 12, 14].includes(telemetry.drs) ? 'open' : ''}`}
        >
          DRS{' '}
          {telemetry?.drs == null
            ? '—'
            : [10, 12, 14].includes(telemetry.drs)
              ? 'OPEN'
              : 'CLOSED'}
        </span>
      </div>
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
