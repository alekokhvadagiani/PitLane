import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Play } from 'lucide-react'
import { circuitOutline } from '@/features/replay/countries'
import './lights-out.css'

const LIGHTS = 5
/** Scroll progress at which each light comes on, and when they all go out. */
const LIGHT_STEP = 0.065
const LIGHTS_OUT = 0.4
const LAP_START = LIGHTS_OUT
const LAP_END = 0.94
const TRAIL = 0.07

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * Scroll-driven race start: the five red lights come on one by one, go out,
 * and a car in the winner's colour runs one lap of the latest circuit. The
 * outline is a lap traced from recorded OpenF1 positions; the car's pace
 * follows the scroll, not recorded timing.
 */
export function LightsOut({
  circuit,
  colour,
  replayHref,
}: {
  circuit?: string
  colour: string
  replayHref?: string
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const carRef = useRef<SVGGElement>(null)
  const outline = circuit ? circuitOutline(circuit) : undefined

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const columns = section.querySelectorAll<HTMLElement>('.gantry-column')
    const path = pathRef.current
    const length = path?.getTotalLength() ?? 0
    let frame = 0
    let lastY = window.scrollY
    let speed = 0
    let lastLit = -1
    let lastPhase = ''

    const update = () => {
      frame = 0
      const rect = section.getBoundingClientRect()
      const travel = Math.max(1, rect.height - window.innerHeight)
      const p = still.matches ? 1 : clamp01(-rect.top / travel)
      const lit =
        p >= LIGHTS_OUT ? 0 : Math.min(LIGHTS, Math.floor(p / LIGHT_STEP))
      const phase = p < LIGHTS_OUT ? 'start' : p < 0.96 ? 'lap' : 'finish'
      const lap = clamp01((p - LAP_START) / (LAP_END - LAP_START))

      // Scroll speed drives the streaks, easing off when scrolling stops.
      const y = window.scrollY
      speed = still.matches
        ? 0
        : Math.max(speed * 0.88, Math.min(1, Math.abs(y - lastY) / 70))
      lastY = y

      section.style.setProperty('--lap', lap.toFixed(4))
      section.style.setProperty('--v', speed.toFixed(3))
      section.style.setProperty('--glow', String(lit / LIGHTS))
      section.style.setProperty('--trail', (TRAIL - lap).toFixed(4))
      if (lit !== lastLit) {
        lastLit = lit
        columns.forEach((column, index) => {
          column.dataset.on = String(index < lit)
        })
      }
      if (phase !== lastPhase) {
        lastPhase = phase
        section.dataset.phase = phase
      }
      if (path && carRef.current && length) {
        const at = lap * length
        const here = path.getPointAtLength(at)
        const ahead = path.getPointAtLength(Math.min(length, at + 0.6))
        const behind = path.getPointAtLength(Math.max(0, at - 0.6))
        const angle =
          (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI
        carRef.current.setAttribute(
          'transform',
          `translate(${here.x.toFixed(2)} ${here.y.toFixed(2)}) rotate(${angle.toFixed(1)})`,
        )
      }
      if (speed > 0.01) request()
    }
    const request = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request)
    still.addEventListener('change', request)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
      still.removeEventListener('change', request)
    }
  }, [outline])

  return (
    <section
      ref={sectionRef}
      className="lights-out"
      data-phase="start"
      aria-labelledby="lights-out-title"
      style={{ '--car': colour } as CSSProperties}
    >
      <div className="lights-stage">
        <div className="lights-streaks" aria-hidden="true" />

        <div className="gantry" aria-hidden="true">
          {Array.from({ length: LIGHTS }, (_, index) => (
            <span key={index} className="gantry-column" data-on="false">
              <i />
              <i />
              <i className="lamp" />
              <i className="lamp" />
            </span>
          ))}
        </div>

        {outline ? (
          <svg
            className="lights-circuit"
            viewBox="-8 -8 116 116"
            aria-hidden="true"
          >
            <path className="lap-tarmac" d={outline} />
            <path
              ref={pathRef}
              className="lap-drawn"
              d={outline}
              pathLength={1}
            />
            <path className="lap-trail" d={outline} pathLength={1} />
            <g ref={carRef} className="lap-car">
              <circle r="4.5" className="lap-car-halo" />
              <path d="M -2.6 -1.6 L 2.8 0 L -2.6 1.6 Z" />
            </g>
          </svg>
        ) : null}

        <div className="lights-copy">
          <div className="lights-step" data-step="start">
            <h2 id="lights-out-title">Five red lights.</h2>
            <p>Scroll to start the race.</p>
          </div>
          <div className="lights-step" data-step="lap">
            <p className="lights-title">Lights out.</p>
            <p>
              {outline
                ? `And away for one lap of ${circuit}.`
                : 'And away we go.'}
            </p>
            {outline ? (
              <small>
                Track traced from a recorded lap in the OpenF1 position feed.
                The car moves with your scroll, not race timing.
              </small>
            ) : null}
          </div>
          <div className="lights-step" data-step="finish">
            <p className="lights-title">Chequered flag.</p>
            <p>Now watch the whole race, every car, lap by lap.</p>
            {replayHref ? (
              <a className="race-primary-link" href={replayHref}>
                <Play size={17} aria-hidden="true" /> Replay the race
              </a>
            ) : null}
          </div>
        </div>

        <div className="lights-chequer" aria-hidden="true" />
      </div>
    </section>
  )
}
