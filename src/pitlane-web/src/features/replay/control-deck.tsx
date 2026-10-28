import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import type { HistoricalLap, SessionArchiveStatus } from '@/lib/api'
import {
  lapAt,
  type ReplayClock,
  type TrackStatusBand,
} from '@/features/replay/replay-engine'
import {
  formatClock,
  formatElapsed,
  formatLapTime,
} from '@/features/replay/format'
import './control-deck.css'

export type DeckMarker = {
  id: string
  timeMs: number
  kind: 'radio' | 'pit'
  label: string
  detail: string
}

const SPEEDS = [0.5, 1, 2, 5, 10]

const bandNames: Record<TrackStatusBand['level'], string> = {
  yellow: 'Yellow flag',
  'double-yellow': 'Double yellow flag',
  vsc: 'Virtual safety car',
  sc: 'Safety car',
  red: 'Red flag',
}

function percent(value: number) {
  return `${Math.max(0, Math.min(value * 100, 100)).toFixed(3)}%`
}

/** Groups markers closer than about 22 px so they stay clickable. */
function clusterMarkers(
  markers: DeckMarker[],
  durationMs: number,
  width: number,
) {
  const thresholdMs = (durationMs * 22) / Math.max(width, 280)
  const clusters: DeckMarker[][] = []
  for (const marker of markers) {
    const previous = clusters.at(-1)
    if (previous && marker.timeMs - previous[0].timeMs <= thresholdMs)
      previous.push(marker)
    else clusters.push([marker])
  }
  return clusters
}

/** Lap labels every n laps, so labels never crowd at this width. */
function labelStep(lapCount: number, width: number) {
  const room = width / Math.max(lapCount, 1)
  return [1, 2, 5, 10, 20].find((step) => room * step >= 34) ?? 20
}

type ControlDeckProps = {
  clock: ReplayClock
  startMs: number
  durationMs: number
  /** End of the last recorded lap, when known. */
  finishMs: number | null
  playing: boolean
  canPlay: boolean
  speed: number
  onSpeedChange: (speed: number) => void
  immersive: boolean
  onToggleImmersive: () => void
  onRestart: () => void
  restartsAtLightsOut: boolean
  /** The selected driver's recorded laps, in start order. */
  laps: HistoricalLap[]
  lapsState: 'loading' | 'ready' | 'empty' | 'unavailable'
  totalLaps: number | null
  bands: TrackStatusBand[]
  markers: DeckMarker[]
  rangeRef: RefObject<HTMLInputElement | null>
  /** Whether this session is saved on the API's disk. */
  archive?: SessionArchiveStatus
  notice?: ReactNode
}

function archiveText(archive: SessionArchiveStatus | undefined) {
  switch (archive?.state) {
    case 'queued':
      return 'Waiting to save on this computer'
    case 'saving':
      return `Saving to this computer, ${Math.floor(
        (archive.completedSteps / Math.max(archive.totalSteps, 1)) * 100,
      )}%`
    case 'saved':
      return `Saved on this computer, ${Math.max(1, Math.round(archive.sizeBytes / 1_048_576))} MB`
    case 'failed':
      return `Not saved: ${archive.message ?? 'the download stopped'}`
    default:
      return null
  }
}

/**
 * Replay transport: play, skip, speed and lap controls above a race strip.
 * The strip shows lap ticks, track status periods from race control, and the
 * selected driver's pit stops and team radio. Readouts are written straight
 * to the DOM on each clock tick, so playback never re-renders React.
 */
export function ControlDeck({
  clock,
  startMs,
  durationMs,
  finishMs,
  playing,
  canPlay,
  speed,
  onSpeedChange,
  immersive,
  onToggleImmersive,
  onRestart,
  restartsAtLightsOut,
  laps,
  lapsState,
  totalLaps,
  bands,
  markers,
  rangeRef,
  archive,
  notice,
}: ControlDeckProps) {
  const archiveLabel = archiveText(archive)
  const speedName = useId()
  const stripRef = useRef<HTMLDivElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const lapRef = useRef<HTMLSpanElement>(null)
  const lapTimeRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLSpanElement>(null)
  const [stripWidth, setStripWidth] = useState(720)
  const [openCluster, setOpenCluster] = useState<string | null>(null)

  useEffect(() => {
    const element = stripRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setStripWidth(entry.contentRect.width),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () =>
      clock.subscribe((snapshot) => {
        if (rangeRef.current)
          rangeRef.current.value = String(snapshot.elapsedMs)
        const share = percent(
          durationMs > 0 ? snapshot.elapsedMs / durationMs : 0,
        )
        if (progressRef.current) progressRef.current.style.width = share
        if (playheadRef.current) playheadRef.current.style.left = share
        if (clockRef.current)
          clockRef.current.textContent = formatClock(snapshot.timestampMs)
        if (elapsedRef.current)
          elapsedRef.current.textContent = formatElapsed(snapshot.elapsedMs)
        const driverNumber = laps[0]?.driverNumber
        const lap =
          driverNumber === undefined
            ? null
            : lapAt(laps, driverNumber, snapshot.timestampMs)
        if (lapRef.current)
          lapRef.current.textContent = lap ? String(lap.lapNumber) : '—'
        if (lapTimeRef.current)
          lapTimeRef.current.textContent = formatLapTime(lap?.lapDuration)
      }),
    [clock, durationMs, laps, rangeRef],
  )

  const lapTicks = useMemo(() => {
    const step = labelStep(laps.length, stripWidth)
    return laps.flatMap((lap) => {
      const timeMs = lap.dateStart ? Date.parse(lap.dateStart) : NaN
      if (!Number.isFinite(timeMs)) return []
      return [
        {
          key: `${lap.lapNumber}-${lap.dateStart}`,
          left: percent((timeMs - startMs) / durationMs),
          label:
            lap.lapNumber === 1 || lap.lapNumber % step === 0
              ? String(lap.lapNumber)
              : null,
        },
      ]
    })
  }, [durationMs, laps, startMs, stripWidth])

  const clusters = useMemo(
    () => clusterMarkers(markers, durationMs, stripWidth),
    [durationMs, markers, stripWidth],
  )

  const seek = (elapsedMs: number) =>
    clock.seek(Math.max(0, Math.min(elapsedMs, durationMs)))
  const at = (timeMs: number) => formatElapsed(timeMs - startMs)

  return (
    <footer className="replay-deck" aria-label="Replay controls">
      <div className="deck-bar">
        <div className="deck-transport">
          <button
            type="button"
            className="deck-play"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            aria-keyshortcuts="Space"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            // Pausing must always work, even while a new window loads.
            disabled={!playing && !canPlay}
            onClick={() => (playing ? clock.pause() : clock.play())}
          >
            {playing ? (
              <Pause size={22} aria-hidden="true" fill="currentColor" />
            ) : (
              <Play size={22} aria-hidden="true" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="deck-icon"
            aria-label={
              restartsAtLightsOut ? 'Restart from lights out' : 'Restart replay'
            }
            aria-keyshortcuts="Home"
            title={
              restartsAtLightsOut
                ? 'Restart from lights out (Home)'
                : 'Restart (Home)'
            }
            onClick={onRestart}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="deck-icon deck-skip"
            aria-label="Back 10 seconds"
            aria-keyshortcuts="ArrowLeft"
            title="Back 10 s (←, Shift+← for 60 s)"
            onClick={() => seek(clock.getSnapshot().elapsedMs - 10_000)}
          >
            <SkipBack size={15} aria-hidden="true" />
            <span aria-hidden="true">10</span>
          </button>
          <button
            type="button"
            className="deck-icon deck-skip"
            aria-label="Forward 10 seconds"
            aria-keyshortcuts="ArrowRight"
            title="Forward 10 s (→, Shift+→ for 60 s)"
            onClick={() => seek(clock.getSnapshot().elapsedMs + 10_000)}
          >
            <span aria-hidden="true">10</span>
            <SkipForward size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="deck-lap" aria-label="Lap of the selected driver">
          <span className="deck-lap-word">Lap</span>
          <span className="deck-lap-number" ref={lapRef}>
            —
          </span>
          <span className="deck-lap-total">/{totalLaps ?? '—'}</span>
          <span className="deck-lap-time">
            <span ref={lapTimeRef}>—</span> lap time
          </span>
        </div>

        <div className="deck-clock">
          <span className="deck-clock-time" ref={clockRef}>
            {formatClock(startMs)}
          </span>
          <span className="deck-clock-elapsed">
            <span className="deck-elapsed" ref={elapsedRef}>
              0:00
            </span>{' '}
            of {formatElapsed(durationMs)}
          </span>
          {archiveLabel ? (
            <span
              className="deck-archive"
              data-state={archive?.state}
              role="status"
            >
              {archiveLabel}
            </span>
          ) : null}
        </div>

        <div className="deck-options">
          <div
            className="deck-speed"
            role="radiogroup"
            aria-label="Replay speed"
          >
            {SPEEDS.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name={speedName}
                  value={value}
                  checked={speed === value}
                  onChange={() => onSpeedChange(value)}
                />
                <span>{value}×</span>
              </label>
            ))}
          </div>
          <select
            className="deck-lap-jump"
            aria-label="Jump to lap"
            defaultValue=""
            disabled={lapsState !== 'ready'}
            onChange={(event) => {
              const lapNumber = Number(event.currentTarget.value)
              const lap = laps.find((item) => item.lapNumber === lapNumber)
              event.currentTarget.value = ''
              if (lap?.dateStart) seek(Date.parse(lap.dateStart) - startMs)
            }}
          >
            <option value="" disabled={lapsState === 'ready'}>
              {lapsState === 'ready'
                ? 'Go to lap'
                : lapsState === 'loading'
                  ? 'Loading laps…'
                  : lapsState === 'empty'
                    ? 'No lap data'
                    : 'Laps unavailable'}
            </option>
            {lapsState === 'ready'
              ? laps.map((lap) => (
                  <option
                    key={`${lap.lapNumber}-${lap.dateStart}`}
                    value={lap.lapNumber}
                  >
                    Lap {lap.lapNumber}
                  </option>
                ))
              : null}
          </select>
          <button
            type="button"
            className="deck-icon"
            aria-pressed={immersive}
            aria-keyshortcuts="F"
            aria-label={immersive ? 'Exit full screen' : 'Full screen'}
            title={
              immersive ? 'Exit full screen (F or Esc)' : 'Full screen (F)'
            }
            onClick={onToggleImmersive}
          >
            {immersive ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="deck-strip" ref={stripRef}>
        <div className="deck-status" aria-label="Track status periods">
          {bands.map((band) => {
            const left = percent((band.fromMs - startMs) / durationMs)
            const width = percent((band.toMs - band.fromMs) / durationMs)
            const name = bandNames[band.level]
            const span = `${at(band.fromMs)} to ${at(band.toMs)}`
            return band.level === 'yellow' || band.level === 'double-yellow' ? (
              <span
                key={`${band.level}-${band.fromMs}`}
                className={`deck-band ${band.level}`}
                style={{ left, width }}
                title={`${name}, ${span}`}
                aria-hidden="true"
              />
            ) : (
              <button
                type="button"
                key={`${band.level}-${band.fromMs}`}
                className={`deck-band ${band.level}`}
                style={{ left, width }}
                title={`${name}, ${span}`}
                aria-label={`Jump to ${name.toLowerCase()}, ${at(band.fromMs)}`}
                onClick={() => seek(band.fromMs - startMs)}
              />
            )
          })}
        </div>

        <div className="deck-track">
          <div className="deck-lap-ticks" aria-hidden="true">
            {lapTicks.map((tick) => (
              <span
                key={tick.key}
                className={tick.label ? 'labelled' : undefined}
                style={{ left: tick.left }}
              >
                {tick.label ? <b>{tick.label}</b> : null}
              </span>
            ))}
            {finishMs !== null ? (
              <i
                className="deck-finish"
                title="Last recorded lap ends"
                style={{ left: percent((finishMs - startMs) / durationMs) }}
              />
            ) : null}
          </div>
          <div className="deck-progress" ref={progressRef} />
          <input
            ref={rangeRef}
            className="deck-scrubber"
            type="range"
            min="0"
            max={durationMs}
            step="1"
            defaultValue="0"
            aria-label="Seek through session replay"
            onInput={(event) => seek(Number(event.currentTarget.value))}
          />
        </div>

        <div className="deck-markers" aria-label="Pit stops and team radio">
          {clusters.map((cluster) => {
            const first = cluster[0]
            const key = cluster.map((marker) => marker.id).join('|')
            const fraction = (first.timeMs - startMs) / durationMs
            if (cluster.length === 1)
              return (
                <button
                  type="button"
                  key={key}
                  className={`deck-marker ${first.kind}`}
                  style={{ left: percent(fraction) }}
                  title={`${first.label}, ${at(first.timeMs)}. ${first.detail}`}
                  aria-label={`Jump to ${first.label}, ${at(first.timeMs)}`}
                  onClick={() => seek(first.timeMs - startMs)}
                >
                  {first.kind === 'pit' ? (
                    <span aria-hidden="true">P</span>
                  ) : null}
                </button>
              )
            const kinds = new Set(cluster.map((marker) => marker.kind))
            return (
              <div
                key={key}
                className="deck-cluster"
                style={{ left: percent(fraction) }}
              >
                <button
                  type="button"
                  className={`deck-marker cluster ${kinds.size === 1 ? first.kind : 'mixed'}`}
                  aria-label={`${cluster.length} recorded events near ${at(first.timeMs)}`}
                  aria-expanded={openCluster === key}
                  onClick={() =>
                    setOpenCluster((open) => (open === key ? null : key))
                  }
                >
                  {cluster.length}
                </button>
                {openCluster === key ? (
                  <div
                    className={`deck-menu ${fraction > 0.5 ? 'align-right' : 'align-left'}`}
                  >
                    {cluster.map((marker) => (
                      <button
                        type="button"
                        key={marker.id}
                        className={marker.kind}
                        onClick={() => {
                          seek(marker.timeMs - startMs)
                          setOpenCluster(null)
                        }}
                      >
                        <span>{marker.label}</span>
                        <small>
                          {at(marker.timeMs)}, {marker.detail}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <span className="deck-playhead" ref={playheadRef} aria-hidden="true" />
      </div>
      {notice}
    </footer>
  )
}
