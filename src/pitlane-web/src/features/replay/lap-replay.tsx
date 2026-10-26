import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, ChevronDown, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getDriverLaps,
  getDriverPositions,
  getSessionDrivers,
  type HistoricalLap,
  type HistoricalPosition,
  type RaceSession,
} from '@/lib/api'
import { normalizeLapTimeline } from '@/features/replay/timeline'

const MAX_LAP_WINDOW_SECONDS = 180
const MAX_POSITION_GAP_MS = 1_500

type Point = { x: number; y: number; dateMs: number }

function lapPositionWindow(lap: HistoricalLap) {
  if (!lap.dateStart || lap.lapDuration === null) return null
  const lapStart = Date.parse(lap.dateStart)
  if (!Number.isFinite(lapStart)) return null
  const durationMs = Math.min(
    lap.lapDuration * 1_000,
    (MAX_LAP_WINDOW_SECONDS - 4) * 1_000,
  )
  return {
    fromUtc: new Date(lapStart - 2_000).toISOString(),
    toUtc: new Date(lapStart + durationMs + 2_000).toISOString(),
    durationMs,
    truncated: lap.lapDuration * 1_000 > durationMs,
  }
}

function toPoints(samples: HistoricalPosition[]) {
  return samples.flatMap((sample) => {
    const dateMs = Date.parse(sample.date)
    if (sample.x === null || sample.y === null || !Number.isFinite(dateMs))
      return []
    return [{ x: sample.x, y: sample.y, dateMs }]
  })
}

function mapPoints(points: Point[]) {
  if (points.length === 0) return { points: [] as Point[], bounds: null }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = Math.max(maxX - minX, 1)
  const height = Math.max(maxY - minY, 1)
  const scale = Math.min(420 / width, 290 / height)
  const plotWidth = width * scale
  const offsetX = (500 - plotWidth) / 2
  return {
    points: points.map((point) => ({
      ...point,
      x: offsetX + (point.x - minX) * scale,
      y: 175 - (point.y - (minY + maxY) / 2) * scale,
    })),
    bounds: { minX, maxX, minY, maxY },
  }
}

function makePaths(points: Point[]) {
  const paths: string[] = []
  let current: Point[] = []
  for (const point of points) {
    const previous = current.at(-1)
    if (previous && point.dateMs - previous.dateMs > MAX_POSITION_GAP_MS) {
      if (current.length > 1)
        paths.push(
          current
            .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' '),
        )
      current = []
    }
    current.push(point)
  }
  if (current.length > 1)
    paths.push(
      current.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    )
  return paths
}

function getPositionAt(points: Point[], targetMs: number) {
  if (points.length === 0) return null
  let low = 0
  let high = points.length
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    if (points[mid].dateMs < targetMs) low = mid + 1
    else high = mid
  }
  const rightIndex = low
  if (rightIndex >= points.length) return null
  const right = points[rightIndex]
  const left = points[rightIndex - 1]
  if (!left)
    return Math.abs(right.dateMs - targetMs) <= MAX_POSITION_GAP_MS
      ? right
      : null
  const gap = right.dateMs - left.dateMs
  if (gap <= 0 || gap > MAX_POSITION_GAP_MS || targetMs < left.dateMs)
    return null
  const fraction = Math.min((targetMs - left.dateMs) / gap, 1)
  return {
    x: left.x + (right.x - left.x) * fraction,
    y: left.y + (right.y - left.y) * fraction,
    dateMs: targetMs,
  }
}

function formatLapTime(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

function formatSessionTime(value: number) {
  const date = new Date(value)
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date)
}

export function LapReplay({ session }: { session: RaceSession }) {
  const drivers = useQuery({
    queryKey: ['historical-drivers', session.sessionKey],
    queryFn: ({ signal }) => getSessionDrivers(session.sessionKey, signal),
    staleTime: 30 * 60_000,
    retry: false,
  })
  const [driverNumber, setDriverNumber] = useState<number | null>(null)
  const selectedDriver =
    drivers.data?.items.find(
      (driver) => driver.driverNumber === driverNumber,
    ) ?? drivers.data?.items[0]
  const laps = useQuery({
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
  const availableLaps =
    laps.data?.items.filter(
      (lap) =>
        lap.dateStart !== null &&
        Number.isFinite(Date.parse(lap.dateStart)) &&
        lap.lapDuration !== null &&
        lap.lapDuration > 0,
    ) ?? []
  const [lapNumber, setLapNumber] = useState<number | null>(null)
  const selectedLap =
    availableLaps.find((lap) => lap.lapNumber === lapNumber) ?? availableLaps[0]
  const window = selectedLap ? lapPositionWindow(selectedLap) : null
  const positions = useQuery({
    queryKey: [
      'historical-position-window',
      session.sessionKey,
      selectedDriver?.driverNumber,
      window?.fromUtc,
      window?.toUtc,
    ],
    queryFn: ({ signal }) =>
      getDriverPositions(
        session.sessionKey,
        selectedDriver!.driverNumber,
        window!.fromUtc,
        window!.toUtc,
        signal,
      ),
    enabled:
      selectedDriver !== undefined &&
      selectedLap !== undefined &&
      window !== null,
    staleTime: 30 * 60_000,
    retry: false,
  })

  if (drivers.isPending) {
    return (
      <section className="lap-replay panel" aria-label="Session replay">
        <p className="replay-status" role="status">
          Loading session drivers…
        </p>
      </section>
    )
  }
  if (drivers.isError) {
    return (
      <section className="lap-replay panel" aria-label="Session replay">
        <div className="replay-status" role="alert">
          Driver data could not be loaded.
          <Button
            size="small"
            variant="secondary"
            onClick={() => void drivers.refetch()}
          >
            Retry
          </Button>
        </div>
      </section>
    )
  }
  if (!selectedDriver) {
    return (
      <section className="lap-replay panel" aria-label="Session replay">
        <p className="replay-status">
          OpenF1 lists no drivers for this session.
        </p>
      </section>
    )
  }

  return (
    <section className="lap-replay panel" aria-label="Historical lap replay">
      <header className="lap-replay-heading">
        <div className="lap-replay-title">
          <Activity size={17} aria-hidden="true" />
          <div>
            <h3>Lap replay</h3>
            <p>Measured position samples from OpenF1</p>
          </div>
        </div>
        <div className="replay-selectors">
          <label>
            Driver
            <span className="selector-control">
              <select
                aria-label="Driver"
                value={selectedDriver.driverNumber}
                onChange={(event) => {
                  setDriverNumber(Number(event.target.value))
                  setLapNumber(null)
                }}
              >
                {drivers.data?.items.map((driver) => (
                  <option key={driver.driverNumber} value={driver.driverNumber}>
                    {driver.nameAcronym} · {driver.fullName}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </label>
          <label>
            Lap
            <span className="selector-control">
              <select
                aria-label="Lap"
                value={selectedLap?.lapNumber ?? ''}
                disabled={laps.isPending || availableLaps.length === 0}
                onChange={(event) => setLapNumber(Number(event.target.value))}
              >
                {availableLaps.map((lap) => (
                  <option key={lap.lapNumber} value={lap.lapNumber}>
                    Lap {lap.lapNumber}
                    {lap.isPitOutLap ? ' · Pit out' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </span>
          </label>
        </div>
      </header>

      {laps.isPending ? (
        <p className="replay-status" role="status">
          Loading lap timing for {selectedDriver.nameAcronym}…
        </p>
      ) : null}
      {laps.isError ? (
        <div className="replay-status" role="alert">
          Lap timing could not be loaded.
          <Button
            size="small"
            variant="secondary"
            onClick={() => void laps.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {laps.isSuccess && availableLaps.length === 0 ? (
        <p className="replay-status">
          OpenF1 has no timed laps for this driver in this session.
        </p>
      ) : null}

      {selectedLap && window ? (
        <LapPlayer
          key={`${session.sessionKey}-${selectedDriver.driverNumber}-${selectedLap.lapNumber}`}
          session={session}
          driverName={selectedDriver.fullName}
          teamColour={selectedDriver.teamColour}
          lap={selectedLap}
          durationMs={window.durationMs}
          truncated={window.truncated}
          positions={positions.data?.items ?? []}
          isLoading={positions.isPending}
          isError={positions.isError}
          retry={() => void positions.refetch()}
          totalLapCount={availableLaps.length}
        />
      ) : null}
    </section>
  )
}

function LapPlayer({
  session,
  driverName,
  teamColour,
  lap,
  durationMs,
  truncated,
  positions,
  isLoading,
  isError,
  retry,
  totalLapCount,
}: {
  session: RaceSession
  driverName: string
  teamColour: string
  lap: HistoricalLap
  durationMs: number
  truncated: boolean
  positions: HistoricalPosition[]
  isLoading: boolean
  isError: boolean
  retry: () => void
  totalLapCount: number
}) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const markerRef = useRef<SVGCircleElement>(null)
  const rangeRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLOutputElement>(null)
  const playheadRef = useRef(0)
  const points = useMemo(() => mapPoints(toPoints(positions)), [positions])
  const paths = useMemo(() => makePaths(points.points), [points.points])
  const timeline = useMemo(
    () => normalizeLapTimeline(session.dateStart, lap, positions),
    [session.dateStart, lap, positions],
  )
  const lapStartMs = lap.dateStart
    ? Date.parse(lap.dateStart)
    : Date.parse(session.dateStart)
  const driverColor = /^[0-9a-f]{6}$/i.test(teamColour)
    ? `#${teamColour}`
    : '#f1665a'

  const renderPlayhead = useCallback(
    (milliseconds: number) => {
      const elapsed = Math.max(0, Math.min(milliseconds, durationMs))
      const target = getPositionAt(points.points, lapStartMs + elapsed)
      if (markerRef.current) {
        markerRef.current.style.opacity = target ? '1' : '0'
        if (target) {
          markerRef.current.setAttribute('cx', target.x.toFixed(2))
          markerRef.current.setAttribute('cy', target.y.toFixed(2))
        }
      }
      if (rangeRef.current) rangeRef.current.value = String(elapsed)
      if (timeRef.current)
        timeRef.current.textContent = formatSessionTime(lapStartMs + elapsed)
    },
    [points.points, lapStartMs, durationMs],
  )

  useEffect(() => {
    playheadRef.current = 0
    renderPlayhead(0)
  }, [lap.lapNumber, session.sessionKey, renderPlayhead])

  useEffect(() => {
    if (!playing || positions.length === 0) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const next = playheadRef.current + (now - previous) * speed
      previous = now
      if (next >= durationMs) {
        playheadRef.current = durationMs
        renderPlayhead(durationMs)
        setPlaying(false)
        return
      }
      playheadRef.current = next
      renderPlayhead(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, durationMs, positions.length, renderPlayhead])

  function seek(value: number) {
    playheadRef.current = value
    renderPlayhead(value)
  }

  const sectorEvents = timeline.events.filter(
    (event) => event.kind === 'sector',
  )
  const positionCount = positions.length

  return (
    <div className="lap-player">
      <div className="lap-player-main">
        <div className="position-plot">
          <div className="position-plot-label">
            <span>
              <i style={{ backgroundColor: driverColor }} /> {driverName} ·
              observed lap path
            </span>
            <small>
              {positionCount > 0
                ? `${positionCount.toLocaleString()} samples`
                : 'Waiting for position data'}
            </small>
          </div>
          {positionCount > 0 && points.points.length > 0 ? (
            <svg
              viewBox="0 0 500 350"
              role="img"
              aria-label={`OpenF1 position trace for ${driverName}, lap ${lap.lapNumber}`}
            >
              <rect
                x="0.5"
                y="0.5"
                width="499"
                height="349"
                rx="4"
                className="position-plot-frame"
              />
              {paths.map((path, index) => (
                <polyline
                  key={index}
                  points={path}
                  className="position-trace"
                  style={{ stroke: driverColor }}
                />
              ))}
              {points.points.length > 0 ? (
                <circle
                  cx={points.points[0].x}
                  cy={points.points[0].y}
                  r="3"
                  className="position-start"
                  style={{ fill: driverColor }}
                />
              ) : null}
              <circle
                ref={markerRef}
                cx="250"
                cy="175"
                r="6"
                className="position-marker"
                opacity="0"
                style={{ stroke: driverColor }}
              />
            </svg>
          ) : (
            <div
              className="position-empty"
              role={isError ? 'alert' : isLoading ? 'status' : undefined}
            >
              {isLoading ? (
                'Loading position samples for this lap…'
              ) : isError ? (
                <>
                  <span>Position samples could not be loaded.</span>
                  <Button size="small" variant="secondary" onClick={retry}>
                    Retry
                  </Button>
                </>
              ) : positionCount > 0 ? (
                'Position rows are available, but their X/Y coordinates are missing.'
              ) : (
                'No position samples were returned for this lap.'
              )}
            </div>
          )}
          <p className="position-provenance">
            OpenF1 local X/Y coordinates · gaps over 1.5s are left open · not
            surveyed circuit geometry
          </p>
        </div>

        <aside className="lap-data">
          <p className="lap-data-label">Selected lap</p>
          <strong className="lap-time">{formatLapTime(lap.lapDuration)}</strong>
          <span className="lap-driver">
            {driverName} · lap {lap.lapNumber}
          </span>
          <div className="lap-sectors">
            <div>
              <span>Sector 1</span>
              <strong>{formatLapTime(lap.sector1Duration)}</strong>
            </div>
            <div>
              <span>Sector 2</span>
              <strong>{formatLapTime(lap.sector2Duration)}</strong>
            </div>
            <div>
              <span>Sector 3</span>
              <strong>{formatLapTime(lap.sector3Duration)}</strong>
            </div>
          </div>
          <div className="lap-coverage">
            <span>
              Laps in session<strong>{totalLapCount}</strong>
            </span>
            <span>
              Position samples
              <strong>
                {positionCount > 0
                  ? positionCount
                  : isLoading
                    ? 'Loading'
                    : 'Unavailable'}
              </strong>
            </span>
          </div>
          <p className="lap-approximation">
            {truncated
              ? 'This lap exceeds the three-minute request cap; playback shows its first bounded window. '
              : ''}
            OpenF1 lap start times are approximate. The path uses recorded
            position timestamps.
          </p>
        </aside>
      </div>

      {positions.length > 0 ? (
        <div className="lap-transport">
          <div className="transport-topline">
            <span>
              Session clock <output>{formatSessionTime(lapStartMs)}</output>
            </span>
            <span>
              Lap {lap.lapNumber} of {totalLapCount}
            </span>
          </div>
          <div className="session-timeline" aria-hidden="true">
            <i
              className="lap-timeline-start"
              style={{ left: '0%' }}
              title="Lap start"
            />
            {sectorEvents.map((event, index) => {
              const localOffset =
                event.offsetMs -
                Date.parse(session.dateStart) -
                (lapStartMs - Date.parse(session.dateStart))
              return (
                <i
                  key={`${event.kind}-${index}`}
                  className="lap-timeline-sector"
                  style={{
                    left: `${Math.max(0, Math.min((localOffset / durationMs) * 100, 100))}%`,
                  }}
                  title={event.label}
                />
              )
            })}
          </div>
          <div className="transport-controls">
            <Button
              size="small"
              variant="secondary"
              aria-label="Restart lap"
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
              aria-label={playing ? 'Pause lap replay' : 'Play lap replay'}
              disabled={positionCount < 2}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? (
                <Pause size={15} aria-hidden="true" />
              ) : (
                <Play size={15} aria-hidden="true" />
              )}
            </Button>
            <label className="playback-speed">
              Speed
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="4">4×</option>
              </select>
            </label>
            <input
              ref={rangeRef}
              className="lap-seek"
              type="range"
              min="0"
              max={durationMs}
              step="100"
              defaultValue="0"
              aria-label="Seek within selected lap"
              onInput={(event) => seek(Number(event.currentTarget.value))}
            />
            <output ref={timeRef} className="lap-clock">
              {formatSessionTime(lapStartMs)}
            </output>
          </div>
        </div>
      ) : null}
    </div>
  )
}
