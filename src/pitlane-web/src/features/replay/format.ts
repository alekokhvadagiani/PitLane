/** Replay time formatting shared by the replay workspace and control deck. */

// Built once: formatClock runs on every playback frame.
const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short',
})

export function formatClock(value: number) {
  return Number.isFinite(value) ? clockFormat.format(value) : '—'
}

export function formatElapsed(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function formatLapTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}
