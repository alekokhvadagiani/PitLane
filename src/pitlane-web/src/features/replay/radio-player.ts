import { useCallback, useEffect, useRef, useState } from 'react'
import {
  radioClipsCrossed,
  type RadioClip,
  type ReplayClock,
} from './replay-engine'

const AUTOPLAY_KEY = 'pitlane.radioAutoplay'
/** A bigger step between clock ticks than this is a seek, not playback. */
const SEEK_STEP_MS = 2_000
const MAX_QUEUE = 3

function readAutoplay() {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'off'
  } catch {
    return true
  }
}

export type RadioPlayer = {
  nowPlaying: RadioClip | null
  progress: number
  autoplay: boolean
  setAutoplay: (value: boolean) => void
  play: (clip: RadioClip) => void
  stop: () => void
}

/**
 * Plays team radio in step with the replay. While the replay runs at up to
 * 2x, a clip starts when the playhead passes its recording time; clips that
 * overlap wait in a short queue. Seeking stops playback, and pausing the
 * replay pauses the clip.
 */
export function useRadioPlayer(
  clock: ReplayClock,
  clips: RadioClip[],
): RadioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queue = useRef<RadioClip[]>([])
  const [nowPlaying, setNowPlaying] = useState<RadioClip | null>(null)
  const [progress, setProgress] = useState(0)
  const [autoplay, setAutoplayState] = useState(readAutoplay)
  const autoplayRef = useRef(autoplay)

  const audio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.preload = 'auto'
    }
    return audioRef.current
  }, [])

  const start = useCallback(
    (clip: RadioClip) => {
      const element = audio()
      element.src = clip.url
      setNowPlaying(clip)
      setProgress(0)
      element.play().catch(() => {
        // Blocked or failed (no network, autoplay policy): drop this clip.
        setNowPlaying(null)
      })
    },
    [audio],
  )

  const stop = useCallback(() => {
    queue.current = []
    const element = audioRef.current
    if (element) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    setNowPlaying(null)
    setProgress(0)
  }, [])

  const play = useCallback(
    (clip: RadioClip) => {
      queue.current = []
      start(clip)
    },
    [start],
  )

  const setAutoplay = useCallback((value: boolean) => {
    autoplayRef.current = value
    setAutoplayState(value)
    try {
      localStorage.setItem(AUTOPLAY_KEY, value ? 'on' : 'off')
    } catch {
      // Preference only lasts this visit when storage is blocked.
    }
  }, [])

  // Advance through the queue and report progress from the audio element.
  useEffect(() => {
    const element = audio()
    const next = () => {
      const following = queue.current.shift()
      if (following) start(following)
      else {
        setNowPlaying(null)
        setProgress(0)
      }
    }
    const update = () => {
      if (element.duration > 0)
        setProgress(Math.min(element.currentTime / element.duration, 1))
    }
    element.addEventListener('ended', next)
    element.addEventListener('error', next)
    element.addEventListener('timeupdate', update)
    return () => {
      element.removeEventListener('ended', next)
      element.removeEventListener('error', next)
      element.removeEventListener('timeupdate', update)
    }
  }, [audio, start])

  // Follow the replay clock.
  useEffect(() => {
    let previousMs: number | null = null
    let wasPlaying = clock.getSnapshot().isPlaying
    return clock.subscribe((snapshot) => {
      const element = audioRef.current
      const lastMs = previousMs
      previousMs = snapshot.timestampMs
      if (snapshot.isPlaying !== wasPlaying) {
        wasPlaying = snapshot.isPlaying
        if (element?.getAttribute('src')) {
          if (snapshot.isPlaying) void element.play().catch(() => undefined)
          else element.pause()
        }
      }
      if (lastMs === null) return
      const step = snapshot.timestampMs - lastMs
      if (step < 0 || step > SEEK_STEP_MS) {
        if (element?.getAttribute('src') && !element.paused) stop()
        else queue.current = []
        return
      }
      if (!snapshot.isPlaying || !autoplayRef.current || snapshot.speed > 2)
        return
      for (const clip of radioClipsCrossed(
        clips,
        lastMs,
        snapshot.timestampMs,
      )) {
        const busy = element?.getAttribute('src') && !element.paused
        if (!busy) start(clip)
        else if (queue.current.length < MAX_QUEUE) queue.current.push(clip)
      }
    })
  }, [clips, clock, start, stop])

  useEffect(
    () => () => {
      audioRef.current?.pause()
    },
    [],
  )

  return { nowPlaying, progress, autoplay, setAutoplay, play, stop }
}
