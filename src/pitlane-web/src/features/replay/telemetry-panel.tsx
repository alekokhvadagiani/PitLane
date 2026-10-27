import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { HistoricalCarSample, HistoricalDriver } from '@/lib/api'
import type { CompareContext } from './compare-panel'
import { TyreLoader } from './tyre'
import {
  aeroAidStateAt,
  ReplayClock,
  telemetryAt,
  type AeroAidChange,
} from '@/features/replay/replay-engine'

const TRACE_MS = 20_000
const TRACE_WIDTH = 300
const TRACE_HEIGHT = 64
const SPEED_SCALE = 360
// OpenF1 has no per-car redline, so the lights use a fixed display range.
const RPM_SCALE = 15_000
const RPM_LIGHTS = 15
const DRS_OPEN = new Set([10, 12, 14])

function teamColour(colour: string | undefined) {
  return colour && /^[0-9a-f]{6}$/i.test(colour) ? `#${colour}` : '#7b828c'
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  const last = parts.pop() ?? ''
  return { first: parts.join(' '), last }
}

// Recorded speed over the last 20 s, plus a red band where the brake was on.
// Gaps over 3 s break the line instead of being bridged.
function drawTrace(
  line: SVGPolylineElement | null,
  brake: SVGPathElement | null,
  samples: HistoricalCarSample[],
  sampleTimes: number[],
  timestampMs: number,
) {
  if (!line || !brake) return
  const fromMs = timestampMs - TRACE_MS
  let low = 0
  let high = sampleTimes.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (sampleTimes[mid] < fromMs) low = mid + 1
    else high = mid
  }
  const points: string[] = []
  let brakePath = ''
  let previousMs: number | null = null
  for (let index = low; index < samples.length; index++) {
    const dateMs = sampleTimes[index]
    if (dateMs > timestampMs) break
    const sample = samples[index]
    const x = ((dateMs - fromMs) / TRACE_MS) * TRACE_WIDTH
    if (previousMs !== null && dateMs - previousMs > 3_000) points.push('')
    previousMs = dateMs
    if (sample.speed != null) {
      const y =
        TRACE_HEIGHT -
        4 -
        Math.max(0, Math.min(sample.speed / SPEED_SCALE, 1)) *
          (TRACE_HEIGHT - 8)
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    if (sample.brake != null && sample.brake > 0)
      brakePath += `M${x.toFixed(1)} ${TRACE_HEIGHT - 2}h3`
  }
  // A polyline cannot hold gaps, so keep only the latest continuous run.
  const lastBreak = points.lastIndexOf('')
  const run = lastBreak === -1 ? points : points.slice(lastBreak + 1)
  const value = run.join(' ')
  if (line.getAttribute('points') !== value) line.setAttribute('points', value)
  if (brake.getAttribute('d') !== brakePath) brake.setAttribute('d', brakePath)
}

/** Selected driver: official headshot on a team-colour panel. */
export function DriverCard({ driver }: { driver?: HistoricalDriver }) {
  // formula1.com serves sharper renditions at the same path; try the 2-column
  // size first and fall back to the URL OpenF1 provided.
  const candidates = useMemo(() => {
    const url = driver?.headshotUrl
    if (!url) return []
    const sharper = url.replace('/transform/1col/', '/transform/2col/')
    return sharper === url ? [url] : [sharper, url]
  }, [driver?.headshotUrl])
  const [failed, setFailed] = useState<string[]>([])
  const colour = teamColour(driver?.teamColour)
  const photo = candidates.find((url) => !failed.includes(url)) ?? null
  const { first, last } = splitName(driver?.fullName ?? 'Select a driver')
  return (
    <div className="driver-card" style={{ '--team': colour } as CSSProperties}>
      <div className="driver-card-portrait">
        <span className="driver-card-number" aria-hidden="true">
          {driver?.driverNumber ?? ''}
        </span>
        {photo ? (
          <img
            key={photo}
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed((list) => [...list, photo])}
          />
        ) : (
          <span className="driver-card-initials" aria-hidden="true">
            {driver?.nameAcronym ?? '—'}
          </span>
        )}
      </div>
      <div className="driver-card-name">
        <span>{first}</span>
        <strong>{last}</strong>
        <small>
          {driver ? `${driver.teamName} · #${driver.driverNumber}` : '—'}
        </small>
      </div>
    </div>
  )
}

/**
 * Onboard readout in the style of a broadcast graphic. Everything updates
 * from the replay clock through refs; React never re-renders per frame.
 */
export function CarTelemetry({
  samples,
  clock,
  aero,
}: {
  samples: HistoricalCarSample[]
  clock: ReplayClock
  aero: AeroContext
}) {
  const root = useRef<HTMLDivElement>(null)
  const sampleStatus = useRef<HTMLElement>(null)
  const speed = useRef<HTMLElement>(null)
  const gear = useRef<HTMLElement>(null)
  const rpm = useRef<HTMLElement>(null)
  const lights = useRef<HTMLSpanElement[]>([])
  const throttleFill = useRef<HTMLSpanElement>(null)
  const throttleValue = useRef<HTMLElement>(null)
  const brakeFill = useRef<HTMLSpanElement>(null)
  const brakeValue = useRef<HTMLElement>(null)
  const traceLine = useRef<SVGPolylineElement>(null)
  const traceBrake = useRef<SVGPathElement>(null)
  const sampleTimes = useMemo(
    () => samples.map((sample) => Date.parse(sample.date)),
    [samples],
  )

  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        const item = telemetryAt(samples, timestampMs)
        const text = (node: HTMLElement | null, value: string) => {
          if (node && node.textContent !== value) node.textContent = value
        }
        text(
          sampleStatus.current,
          item
            ? `Sample ${Math.max(0, (timestampMs - Date.parse(item.date)) / 1_000).toFixed(1)}s`
            : 'NO SAMPLE',
        )
        text(
          speed.current,
          item?.speed == null ? '—' : String(Math.round(item.speed)),
        )
        text(
          gear.current,
          item?.gear == null ? '—' : item.gear === 0 ? 'N' : String(item.gear),
        )
        text(
          rpm.current,
          item?.rpm == null
            ? '—'
            : Math.round(item.rpm).toLocaleString('en-US'),
        )
        const lit =
          item?.rpm == null
            ? 0
            : Math.round(
                Math.max(0, Math.min(item.rpm / RPM_SCALE, 1)) * RPM_LIGHTS,
              )
        lights.current.forEach((light, index) =>
          light.toggleAttribute('data-on', index < lit),
        )
        const throttle =
          item?.throttle == null
            ? null
            : Math.max(0, Math.min(item.throttle, 100))
        if (throttleFill.current)
          throttleFill.current.style.width = `${throttle ?? 0}%`
        text(
          throttleValue.current,
          throttle === null ? '—' : `${Math.round(throttle)}%`,
        )
        const braking = item?.brake == null ? null : item.brake > 0
        if (brakeFill.current)
          brakeFill.current.style.width = braking ? '100%' : '0%'
        text(
          brakeValue.current,
          braking === null ? '—' : braking ? 'ON' : 'OFF',
        )
        if (root.current)
          root.current.setAttribute(
            'aria-label',
            `Recorded speed ${item?.speed == null ? 'unavailable' : Math.round(item.speed)} km/h, gear ${item?.gear ?? 'unavailable'}, throttle ${throttle === null ? 'unavailable' : Math.round(throttle)} percent`,
          )
        drawTrace(
          traceLine.current,
          traceBrake.current,
          samples,
          sampleTimes,
          timestampMs,
        )
      }),
    [clock, sampleTimes, samples],
  )

  return (
    <div
      className="car-telemetry"
      ref={root}
      role="group"
      aria-label="Recorded car telemetry"
    >
      <div className="instrument-heading">
        <span>Onboard</span>
        <b ref={sampleStatus}>NO SAMPLE</b>
      </div>
      <div className="ct-primary">
        <div className="ct-speed">
          <strong ref={speed}>—</strong>
          <span>km/h</span>
        </div>
        <div className="ct-gear" aria-label="Gear">
          <span>Gear</span>
          <strong ref={gear}>—</strong>
        </div>
      </div>
      <div className="ct-rpm">
        <div className="ct-lights" aria-hidden="true">
          {Array.from({ length: RPM_LIGHTS }, (_, index) => (
            <span
              key={index}
              data-band={index < 5 ? 'low' : index < 10 ? 'mid' : 'high'}
              ref={(node) => {
                if (node) lights.current[index] = node
              }}
            />
          ))}
        </div>
        <span className="ct-rpm-readout">
          <b ref={rpm} className="ct-rpm-value">
            —
          </b>{' '}
          rpm
        </span>
      </div>
      <div className="ct-pedals">
        <div className="ct-pedal ct-throttle">
          <span>Throttle</span>
          <span className="ct-bar">
            <span ref={throttleFill} className="ct-throttle-fill" />
          </span>
          <b ref={throttleValue}>—</b>
        </div>
        <div className="ct-pedal ct-brake">
          <span>Brake</span>
          <span className="ct-bar">
            <span ref={brakeFill} className="ct-brake-fill" />
          </span>
          <b ref={brakeValue}>—</b>
        </div>
      </div>
      <div className="ct-trace">
        <div className="ct-trace-heading">
          <span>Speed, last 20 s</span>
          <AeroIndicators
            variant="broadcast"
            samples={samples}
            clock={clock}
            aero={aero}
          />
        </div>
        <svg
          viewBox={`0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            className="ct-trace-grid"
            x1="0"
            x2={TRACE_WIDTH}
            y1={TRACE_HEIGHT / 2}
            y2={TRACE_HEIGHT / 2}
          />
          <path ref={traceBrake} className="ct-trace-brake" d="" />
          <polyline ref={traceLine} className="ct-trace-line" points="" />
        </svg>
      </div>
    </div>
  )
}

// ---------- Cockpit view: dial in the style of an on-car display ----------

const DIAL_CX = 200
const DIAL_CY = 200
const DIAL_R = 158
const DIAL_START = -125
const DIAL_END = 125
const RPM_CY = 318
const RPM_R = 72
const RPM_START = -72
const RPM_END = 72
const RPM_DIAL_MAX = 16_000
const RPM_SEGMENTS = 30
const PEDAL_BARS = 12

function polar(cx: number, cy: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return { x: cx + r * Math.sin(radians), y: cy - r * Math.cos(radians) }
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const start = polar(cx, cy, r, from)
  const end = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} A${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

const SPEED_ARC = arcPath(DIAL_CX, DIAL_CY, DIAL_R, DIAL_START, DIAL_END)

export function CockpitTelemetry({
  samples,
  clock,
  aero,
}: {
  samples: HistoricalCarSample[]
  clock: ReplayClock
  aero: AeroContext
}) {
  const root = useRef<HTMLDivElement>(null)
  const sampleStatus = useRef<HTMLElement>(null)
  const speedArc = useRef<SVGPathElement>(null)
  const speedTip = useRef<SVGLineElement>(null)
  const speed = useRef<SVGTextElement>(null)
  const rpm = useRef<SVGTextElement>(null)
  const rpmSegments = useRef<SVGLineElement[]>([])
  const throttleBars = useRef<HTMLSpanElement[]>([])
  const brakeBars = useRef<HTMLSpanElement[]>([])
  const throttleValue = useRef<HTMLElement>(null)
  const brakeValue = useRef<HTMLElement>(null)
  const gear = useRef<HTMLElement>(null)

  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        const item = telemetryAt(samples, timestampMs)
        const text = (node: Element | null, value: string) => {
          if (node && node.textContent !== value) node.textContent = value
        }
        text(
          sampleStatus.current,
          item
            ? `Sample ${Math.max(0, (timestampMs - Date.parse(item.date)) / 1_000).toFixed(1)}s`
            : 'NO SAMPLE',
        )
        const speedShare =
          item?.speed == null
            ? null
            : Math.max(0, Math.min(item.speed / SPEED_SCALE, 1))
        if (speedArc.current) {
          const dash = `${((speedShare ?? 0) * 100).toFixed(2)} 100`
          if (speedArc.current.style.strokeDasharray !== dash)
            speedArc.current.style.strokeDasharray = dash
        }
        if (speedTip.current) {
          speedTip.current.style.opacity = speedShare === null ? '0' : '1'
          speedTip.current.setAttribute(
            'transform',
            `rotate(${(DIAL_START + (speedShare ?? 0) * (DIAL_END - DIAL_START)).toFixed(2)} ${DIAL_CX} ${DIAL_CY})`,
          )
        }
        text(
          speed.current,
          item?.speed == null ? '—' : String(Math.round(item.speed)),
        )
        text(
          rpm.current,
          item?.rpm == null
            ? '—'
            : Math.round(item.rpm).toLocaleString('en-US'),
        )
        const litRpm =
          item?.rpm == null
            ? 0
            : Math.round(
                Math.max(0, Math.min(item.rpm / RPM_DIAL_MAX, 1)) *
                  RPM_SEGMENTS,
              )
        rpmSegments.current.forEach((segment, index) =>
          segment.toggleAttribute('data-on', index < litRpm),
        )
        const throttle =
          item?.throttle == null
            ? null
            : Math.max(0, Math.min(item.throttle, 100))
        const litThrottle = Math.round(((throttle ?? 0) / 100) * PEDAL_BARS)
        throttleBars.current.forEach((bar, index) =>
          bar.toggleAttribute('data-on', index < litThrottle),
        )
        text(
          throttleValue.current,
          throttle === null ? '—' : `${Math.round(throttle)}%`,
        )
        // OpenF1 brake is recorded as on/off, so the bars are all or nothing.
        const braking = item?.brake == null ? null : item.brake > 0
        brakeBars.current.forEach((bar) =>
          bar.toggleAttribute('data-on', braking === true),
        )
        text(
          brakeValue.current,
          braking === null ? '—' : braking ? 'ON' : 'OFF',
        )
        text(
          gear.current,
          item?.gear == null ? '—' : item.gear === 0 ? 'N' : String(item.gear),
        )
        if (root.current)
          root.current.setAttribute(
            'aria-label',
            `Recorded speed ${item?.speed == null ? 'unavailable' : Math.round(item.speed)} km/h, gear ${item?.gear ?? 'unavailable'}, throttle ${throttle === null ? 'unavailable' : Math.round(throttle)} percent`,
          )
      }),
    [clock, samples],
  )

  return (
    <div
      className="cockpit-telemetry"
      ref={root}
      role="group"
      aria-label="Recorded car telemetry"
    >
      <div className="instrument-heading">
        <span>Onboard</span>
        <b ref={sampleStatus}>NO SAMPLE</b>
      </div>
      <svg className="cockpit-dial" viewBox="-12 -8 424 360" aria-hidden="true">
        <defs>
          <filter
            id="cockpit-glow"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="cockpit-speed" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#b3000f" />
            <stop offset="1" stopColor="#ff2d3d" />
          </linearGradient>
        </defs>
        <circle className="cockpit-face" cx={DIAL_CX} cy={DIAL_CY} r="128" />
        <path className="cockpit-rail" d={SPEED_ARC} pathLength={100} />
        <path
          ref={speedArc}
          className="cockpit-speed-arc"
          d={SPEED_ARC}
          pathLength={100}
          stroke="url(#cockpit-speed)"
          filter="url(#cockpit-glow)"
          style={{ strokeDasharray: '0 100' }}
        />
        <path
          className="cockpit-bezel"
          d={arcPath(DIAL_CX, DIAL_CY, DIAL_R + 22, DIAL_START, DIAL_END)}
        />
        {Array.from({ length: 73 }, (_, index) => {
          const angle = DIAL_START + (index / 72) * (DIAL_END - DIAL_START)
          const major = index % 12 === 0
          const outer = polar(DIAL_CX, DIAL_CY, DIAL_R + 17, angle)
          const inner = polar(
            DIAL_CX,
            DIAL_CY,
            DIAL_R + (major ? 4 : index % 2 === 0 ? 10 : 13),
            angle,
          )
          const label = polar(DIAL_CX, DIAL_CY, DIAL_R + 36, angle)
          return (
            <g key={index}>
              <line
                className={major ? 'cockpit-tick major' : 'cockpit-tick'}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
              />
              {major ? (
                <text className="cockpit-scale" x={label.x} y={label.y + 6}>
                  {(index / 72) * SPEED_SCALE}
                </text>
              ) : null}
            </g>
          )
        })}
        <line
          ref={speedTip}
          className="cockpit-tip"
          x1={DIAL_CX}
          y1={DIAL_CY - DIAL_R - 14}
          x2={DIAL_CX}
          y2={DIAL_CY - DIAL_R + 14}
          style={{ opacity: 0 }}
        />
        <text ref={speed} className="cockpit-speed" x={DIAL_CX} y="168">
          —
        </text>
        <text className="cockpit-unit" x={DIAL_CX} y="194">
          KM/H
        </text>
        {Array.from({ length: RPM_SEGMENTS }, (_, index) => {
          const angle =
            RPM_START + ((index + 0.5) / RPM_SEGMENTS) * (RPM_END - RPM_START)
          const a = polar(DIAL_CX, RPM_CY, RPM_R - 9, angle)
          const b = polar(DIAL_CX, RPM_CY, RPM_R + 9, angle)
          return (
            <line
              key={index}
              ref={(node) => {
                if (node) rpmSegments.current[index] = node
              }}
              className="cockpit-rpm-segment"
              data-zone={index >= RPM_SEGMENTS * 0.72 ? 'red' : 'white'}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            />
          )
        })}
        {[0, 4, 8, 12, 16].map((value) => {
          const angle = RPM_START + (value / 16) * (RPM_END - RPM_START)
          const point = polar(DIAL_CX, RPM_CY, RPM_R + 20, angle)
          return (
            <text
              key={value}
              className={
                value === 16 ? 'cockpit-rpm-scale red' : 'cockpit-rpm-scale'
              }
              x={point.x}
              y={point.y + 4}
            >
              {value === 0 ? '0' : `${value}K`}
            </text>
          )
        })}
        <text ref={rpm} className="cockpit-rpm" x={DIAL_CX} y="312">
          —
        </text>
        <text className="cockpit-unit small" x={DIAL_CX} y="334">
          RPM
        </text>
      </svg>
      <div className="cockpit-controls">
        <div className="cockpit-pedal throttle">
          <div className="cockpit-bars">
            {Array.from({ length: PEDAL_BARS }, (_, index) => (
              <span
                key={index}
                style={{ height: `${100 - index * 4.5}%` }}
                ref={(node) => {
                  if (node) throttleBars.current[index] = node
                }}
              />
            ))}
          </div>
          <div className="cockpit-pedal-label">
            <span>Throttle</span>
            <b ref={throttleValue}>—</b>
          </div>
        </div>
        <div className="cockpit-gear">
          <span>Gear</span>
          <strong ref={gear}>—</strong>
        </div>
        <div className="cockpit-pedal brake">
          <div className="cockpit-bars">
            {Array.from({ length: PEDAL_BARS }, (_, index) => (
              <span
                key={index}
                style={{ height: `${50 + index * 4.5}%` }}
                ref={(node) => {
                  if (node) brakeBars.current[index] = node
                }}
              />
            ))}
          </div>
          <div className="cockpit-pedal-label">
            <span title="OpenF1 records brake as on or off">Brake</span>
            <b ref={brakeValue}>—</b>
          </div>
        </div>
      </div>
      <AeroIndicators
        variant="cockpit"
        samples={samples}
        clock={clock}
        aero={aero}
      />
    </div>
  )
}

type TelemetryView = 'broadcast' | 'cockpit' | 'compare'

// ECharts is large; load it only when someone opens the comparison.
const ComparePanel = lazy(() =>
  import('./compare-panel').then((module) => ({
    default: module.ComparePanel,
  })),
)
const VIEW_KEY = 'pitlane.telemetryView'

function readView(): TelemetryView {
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    return saved === 'cockpit' || saved === 'compare' ? saved : 'broadcast'
  } catch {
    return 'broadcast'
  }
}

/** Switches between the broadcast readout and the cockpit dial. */
export function TelemetryPanel({
  samples,
  clock,
  aero,
  selected,
  compare,
}: {
  samples: HistoricalCarSample[]
  clock: ReplayClock
  aero: AeroContext
  selected?: HistoricalDriver
  compare: CompareContext
}) {
  const [view, setView] = useState<TelemetryView>(readView)
  function choose(next: TelemetryView) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Preference is a convenience; ignore blocked storage.
    }
  }
  return (
    <div className="telemetry-panel">
      <div
        className="telemetry-view-switch"
        role="radiogroup"
        aria-label="Telemetry view"
      >
        {(['broadcast', 'cockpit', 'compare'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={view === option}
            onClick={() => choose(option)}
          >
            {option === 'broadcast'
              ? 'Broadcast'
              : option === 'cockpit'
                ? 'Cockpit'
                : 'Compare'}
          </button>
        ))}
      </div>
      {view === 'compare' ? (
        <Suspense fallback={<TyreLoader label="Loading comparison" compact />}>
          <ComparePanel selected={selected} context={compare} clock={clock} />
        </Suspense>
      ) : view === 'broadcast' ? (
        <CarTelemetry samples={samples} clock={clock} aero={aero} />
      ) : (
        <CockpitTelemetry samples={samples} clock={clock} aero={aero} />
      )}
    </div>
  )
}

// ---------- Aero aids: DRS (per car) or 2026 Overtake Mode / Active Aero ----------

export type AeroContext = {
  /** Season uses 2026 rules (no DRS; Overtake Mode and Active Aero). */
  modernRules: boolean
  overtakeChanges: AeroAidChange[]
  raceControl: 'loading' | 'ready' | 'unavailable'
}

/**
 * Shows what the feed actually records. Per-car DRS when samples carry it.
 * For 2026+ cars OpenF1 has no per-car aero or overtake channel, so Overtake
 * Mode reflects race control's session-wide enable/disable notices and
 * Active Aero is marked as not published.
 */
function AeroIndicators({
  variant,
  samples,
  clock,
  aero,
}: {
  variant: 'broadcast' | 'cockpit'
  samples: HistoricalCarSample[]
  clock: ReplayClock
  aero: AeroContext
}) {
  const hasDrs = useMemo(
    () => samples.some((sample) => sample.drs != null),
    [samples],
  )
  const showDrs = hasDrs || !aero.modernRules
  const drs = useRef<HTMLDivElement>(null)
  const drsValue = useRef<HTMLElement>(null)
  const overtake = useRef<HTMLDivElement>(null)
  const overtakeValue = useRef<HTMLElement>(null)

  useEffect(
    () =>
      clock.subscribe(({ timestampMs }) => {
        if (showDrs) {
          const item = telemetryAt(samples, timestampMs)
          const state =
            item?.drs == null
              ? 'unavailable'
              : DRS_OPEN.has(item.drs)
                ? 'active'
                : 'inactive'
          if (drs.current && drs.current.dataset.state !== state)
            drs.current.dataset.state = state
          const label =
            state === 'unavailable'
              ? 'No data'
              : state === 'active'
                ? 'Open'
                : 'Closed'
          if (drsValue.current && drsValue.current.textContent !== label)
            drsValue.current.textContent = label
          return
        }
        const state =
          aero.raceControl === 'ready'
            ? aeroAidStateAt(aero.overtakeChanges, timestampMs)
            : 'unknown'
        const dataState =
          state === 'enabled'
            ? 'active'
            : state === 'disabled'
              ? 'inactive'
              : 'unavailable'
        if (overtake.current && overtake.current.dataset.state !== dataState)
          overtake.current.dataset.state = dataState
        const label =
          aero.raceControl === 'loading'
            ? 'Loading'
            : aero.raceControl === 'unavailable'
              ? 'No data'
              : state === 'enabled'
                ? 'Enabled'
                : state === 'disabled'
                  ? 'Disabled'
                  : 'Not announced'
        if (
          overtakeValue.current &&
          overtakeValue.current.textContent !== label
        )
          overtakeValue.current.textContent = label
      }),
    [aero.overtakeChanges, aero.raceControl, clock, samples, showDrs],
  )

  if (showDrs)
    return variant === 'cockpit' ? (
      <div className="cockpit-aero">
        <div className="cockpit-drs" ref={drs} data-state="unavailable">
          DRS{' '}
        </div>
      </div>
    ) : (
      <div className="drs-readout" ref={drs} data-state="unavailable">
        DRS <b ref={drsValue}>No data</b>
      </div>
    )

  const overtakeTitle =
    'Race control enables or disables Overtake Mode for the whole session. OpenF1 does not record when each car uses it.'
  const aeroTitle =
    'OpenF1 does not publish Active Aero (straight-line / corner mode) state.'
  return variant === 'cockpit' ? (
    <div className="cockpit-aero">
      <div
        className="cockpit-drs aero-chip"
        ref={overtake}
        data-state="unavailable"
        title={overtakeTitle}
      >
        Overtake
        <b ref={overtakeValue}>Loading</b>
      </div>
      <div
        className="cockpit-drs aero-chip"
        data-state="unavailable"
        title={aeroTitle}
      >
        Active Aero
        <b>Not in feed</b>
      </div>
    </div>
  ) : (
    <div className="aero-readouts">
      <div
        className="drs-readout"
        ref={overtake}
        data-state="unavailable"
        title={overtakeTitle}
      >
        Overtake <b ref={overtakeValue}>Loading</b>
      </div>
      <div className="drs-readout" data-state="unavailable" title={aeroTitle}>
        Active Aero <b>Not in feed</b>
      </div>
    </div>
  )
}
