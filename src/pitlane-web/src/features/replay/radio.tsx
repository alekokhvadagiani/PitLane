import { useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { Mic, Pause, Play, SkipBack, X } from 'lucide-react'
import type { HistoricalDriver } from '@/lib/api'
import type { RadioClip, ReplayClock } from './replay-engine'
import type { RadioPlayer } from './radio-player'

function teamColour(driver?: HistoricalDriver) {
  return driver && /^[0-9a-f]{6}$/i.test(driver.teamColour)
    ? `#${driver.teamColour}`
    : '#aeb7c2'
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1_000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Number of clips at or before the playhead; changes rarely. */
function useClipsHeard(clock: ReplayClock, clips: RadioClip[]) {
  return useSyncExternalStore(
    (onChange) => clock.subscribe(() => onChange()),
    () => {
      const now = clock.getSnapshot().timestampMs
      let low = 0
      let high = clips.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if (clips[mid].timeMs <= now) low = mid + 1
        else high = mid
      }
      return low
    },
  )
}

export type RadioContext = {
  clips: RadioClip[]
  status: 'loading' | 'ready' | 'unavailable'
  player: RadioPlayer
  drivers: HistoricalDriver[]
  startMs: number
  onSeek: (elapsedMs: number) => void
}

/** Team radio heard so far, newest first. Never lists clips from the future. */
export function RadioPanel({
  context,
  clock,
  selected,
}: {
  context: RadioContext
  clock: ReplayClock
  selected?: HistoricalDriver
}) {
  const { clips, status, player, drivers, startMs, onSeek } = context
  const [onlySelected, setOnlySelected] = useState(false)
  const heard = useClipsHeard(clock, clips)
  const byNumber = new Map(
    drivers.map((driver) => [driver.driverNumber, driver]),
  )
  const visible = clips
    .slice(0, heard)
    .filter(
      (clip) => !onlySelected || clip.driverNumber === selected?.driverNumber,
    )
    .reverse()
    .slice(0, 60)
  const later = clips.length - heard

  return (
    <section className="radio-panel" aria-label="Team radio">
      <header className="radio-head">
        <h4>
          <Mic size={13} aria-hidden="true" /> Team radio
          {clips.length ? (
            <span className="radio-count">
              {heard} of {clips.length} clip{clips.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </h4>
        <label className="radio-toggle">
          <input
            type="checkbox"
            checked={player.autoplay}
            onChange={(event) => player.setAutoplay(event.target.checked)}
          />
          Auto-play
        </label>
        <label className="radio-toggle">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(event) => setOnlySelected(event.target.checked)}
            disabled={!selected}
          />
          {selected ? `${selected.nameAcronym} only` : 'Selected only'}
        </label>
      </header>

      {status === 'loading' ? (
        <p className="race-data-note">Loading team radio…</p>
      ) : status === 'unavailable' ? (
        <p className="race-data-note">Team radio could not be loaded.</p>
      ) : clips.length === 0 ? (
        <p className="race-data-note">
          OpenF1 has no team radio for this session.
        </p>
      ) : visible.length === 0 ? (
        <p className="race-data-note">
          {onlySelected
            ? `No radio from ${selected?.nameAcronym} yet.`
            : 'No radio yet at this point in the replay.'}
          {later > 0
            ? ` ${later} clip${later === 1 ? '' : 's'} later in the session.`
            : ''}
        </p>
      ) : (
        <ol className="radio-list">
          {visible.map((clip) => {
            const driver = byNumber.get(clip.driverNumber)
            const playing = player.nowPlaying?.id === clip.id
            return (
              <li
                key={clip.id}
                data-playing={playing || undefined}
                style={{ '--team': teamColour(driver) } as CSSProperties}
              >
                <button
                  type="button"
                  className="radio-play"
                  onClick={() => (playing ? player.stop() : player.play(clip))}
                  aria-label={`${playing ? 'Stop' : 'Play'} ${driver?.nameAcronym ?? clip.driverNumber} radio at ${formatElapsed(clip.timeMs - startMs)}`}
                >
                  {playing ? (
                    <Pause size={13} aria-hidden="true" />
                  ) : (
                    <Play size={13} aria-hidden="true" />
                  )}
                </button>
                <strong>
                  {driver?.nameAcronym ?? `#${clip.driverNumber}`}
                </strong>
                <span className="radio-time">
                  {formatElapsed(clip.timeMs - startMs)}
                </span>
                {playing ? (
                  <span
                    className="radio-progress"
                    style={{ '--p': player.progress } as CSSProperties}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="radio-team">{driver?.teamName ?? ''}</span>
                )}
                <button
                  type="button"
                  className="radio-jump"
                  onClick={() => onSeek(clip.timeMs - startMs - 3_000)}
                  aria-label={`Jump replay to ${driver?.nameAcronym ?? clip.driverNumber} radio`}
                  title="Jump replay to this radio"
                >
                  <SkipBack size={13} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <p className="telemetry-footnote">
        Clips stream from F1 live timing via OpenF1. Times are taken from the
        recording where available. Auto-play runs at 1× and 2×.
      </p>
    </section>
  )
}

/** Banner over the circuit while a clip plays. */
export function RadioNowPlaying({
  clip,
  driver,
  progress,
  onStop,
}: {
  clip: RadioClip
  driver?: HistoricalDriver
  progress: number
  onStop: () => void
}) {
  return (
    <div
      className="radio-now"
      role="status"
      style={{ '--team': teamColour(driver), '--p': progress } as CSSProperties}
    >
      <span className="radio-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="radio-now-text">
        <strong>{driver?.nameAcronym ?? `#${clip.driverNumber}`}</strong>
        <span>Team radio</span>
      </span>
      <button type="button" onClick={onStop} aria-label="Stop team radio">
        <X size={14} aria-hidden="true" />
      </button>
      <span className="radio-now-progress" aria-hidden="true" />
    </div>
  )
}
