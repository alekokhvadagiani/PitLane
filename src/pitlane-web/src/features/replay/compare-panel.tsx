import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import * as echarts from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import type {
  HistoricalDriver,
  HistoricalLap,
  HistoricalPitStop,
} from '@/lib/api'
import type { RaceControlEvent, ReplayClock } from './replay-engine'
import { bestSectors, compareDrivers, type CompareRow } from './compare'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

export type CompareContext = {
  drivers: HistoricalDriver[]
  laps: HistoricalLap[]
  pitStops: HistoricalPitStop[]
  events: RaceControlEvent[]
  /** Car next to the selected one in the running order. */
  defaultRival: number | null
  /** Estimated retirement time of DNF drivers. */
  retiredAt: Map<number, number>
}

const AXIS = '#7d8792'
const GRID_LINE = 'rgba(255,255,255,0.06)'

function colourOf(driver?: HistoricalDriver) {
  return driver && /^[0-9a-f]{6}$/i.test(driver.teamColour)
    ? `#${driver.teamColour}`
    : '#aeb7c2'
}

function lapTime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`
}

function signed(seconds: number | null, digits = 3) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  return `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${Math.abs(seconds).toFixed(digits)}`
}

/** Number of sorted values at or below the limit. */
function countUpTo(sorted: number[], limit: number) {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (sorted[mid] <= limit) low = mid + 1
    else high = mid
  }
  return low
}

function EChart({
  option,
  label,
  height,
}: {
  option: EChartsCoreOption
  label: string
  height: number
}) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    if (!host.current) return
    const instance = echarts.init(host.current, null, { renderer: 'canvas' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(host.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])
  return (
    <div
      ref={host}
      className="compare-chart"
      role="img"
      aria-label={label}
      style={{ height }}
    />
  )
}

/** Laps where the safety car or VSC was out, as shaded bands. */
function neutralisedAreas(rows: CompareRow[]) {
  const areas: [Record<string, unknown>, Record<string, unknown>][] = []
  for (const row of rows) {
    if (!row.neutralised) continue
    const colour =
      row.neutralised === 'sc'
        ? 'rgba(255, 176, 32, 0.16)'
        : 'rgba(255, 176, 32, 0.08)'
    areas.push([
      { xAxis: row.lap - 0.5, itemStyle: { color: colour } },
      { xAxis: row.lap + 0.5 },
    ])
  }
  return areas
}

function baseOption(rows: CompareRow[]) {
  const first = rows[0]?.lap ?? 1
  const last = rows.at(-1)?.lap ?? 1
  return {
    animation: false,
    textStyle: { fontFamily: 'inherit', color: AXIS },
    grid: { left: 46, right: 10, top: 12, bottom: 22 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#15191f',
      borderColor: '#323944',
      textStyle: { color: '#e9ecef', fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      min: first - 0.5,
      max: last + 0.5,
      minInterval: 1,
      axisLabel: {
        color: AXIS,
        fontSize: 10,
        formatter: (value: number) =>
          Number.isInteger(value) ? `L${value}` : '',
      },
      axisLine: { lineStyle: { color: '#39404a' } },
      splitLine: { show: false },
    },
  }
}

export function ComparePanel({
  selected,
  context,
  clock,
}: {
  selected?: HistoricalDriver
  context: CompareContext
  clock: ReplayClock
}) {
  const { drivers, laps, pitStops, events, defaultRival, retiredAt } = context
  const [pickedRival, setPickedRival] = useState<number | null>(null)
  const rivalNumber =
    pickedRival !== null && pickedRival !== selected?.driverNumber
      ? pickedRival
      : defaultRival
  const rival = drivers.find((driver) => driver.driverNumber === rivalNumber)
  const a = selected?.driverNumber ?? null
  const b = rival?.driverNumber ?? null

  // Re-render only when either driver completes (or un-completes) a lap.
  const lapEnds = (() => {
    const ends: number[] = []
    for (const lap of laps) {
      if (lap.driverNumber !== a && lap.driverNumber !== b) continue
      if (!lap.dateStart || lap.lapDuration == null) continue
      const endMs = Date.parse(lap.dateStart) + lap.lapDuration * 1_000
      if (Number.isFinite(endMs)) ends.push(endMs)
    }
    return ends.sort((x, y) => x - y)
  })()
  const completed = useSyncExternalStore(
    (onChange) => clock.subscribe(() => onChange()),
    () => countUpTo(lapEnds, clock.getSnapshot().timestampMs),
  )
  const untilMs = completed > 0 ? lapEnds[completed - 1] : -Infinity

  // A retired driver's last lap ends the comparison; after that there is
  // nothing to compare, and their slow in-lap would distort the gap.
  const retiree = [selected, rival].find(
    (driver) =>
      driver && (retiredAt.get(driver.driverNumber) ?? Infinity) <= untilMs,
  )
  const retireeLastLap = retiree
    ? Math.max(
        0,
        ...laps
          .filter((lap) => lap.driverNumber === retiree.driverNumber)
          .map((lap) => lap.lapNumber),
      )
    : Infinity
  const rows =
    a === null || b === null
      ? []
      : compareDrivers({ laps, pitStops, events, a, b, untilMs }).filter(
          (row) => row.lap <= retireeLastLap,
        )
  const colourA = colourOf(selected)
  const colourB = colourOf(rival)
  // Teammates share a colour: draw the rival dashed and lighter.
  const sameTeam = colourA.toLowerCase() === colourB.toLowerCase()
  const lineB = sameTeam ? '#e9ecef' : colourB

  const lapOption = (() => {
    const times = rows
      .flatMap((row) => [row.a, row.b])
      .filter((value): value is number => value != null)
      .sort((x, y) => x - y)
    const median = times[Math.floor(times.length / 2)] ?? 90
    // Keep racing laps readable: safety-car and pit laps run off the top.
    const top = Math.min(times.at(-1) ?? median, median * 1.08)
    const bottom = times[0] ?? median
    const pad = Math.max((top - bottom) * 0.08, 0.3)
    // Pit markers sit in a strip under the racing laps, not on the line,
    // which usually runs off the chart on a pit lap.
    const pitRow = bottom - pad * 2
    const series = (
      name: string,
      key: 'a' | 'b',
      pitKey: 'pitA' | 'pitB',
      colour: string,
      dashed: boolean,
    ) => [
      {
        name,
        type: 'line',
        data: rows.map((row) => [row.lap, row[key]]),
        connectNulls: false,
        showSymbol: false,
        lineStyle: {
          color: colour,
          width: 2,
          type: dashed ? 'dashed' : 'solid',
        },
        itemStyle: { color: colour },
        markArea:
          key === 'a'
            ? { silent: true, data: neutralisedAreas(rows) }
            : undefined,
      },
      {
        name: `${name} pit`,
        type: 'scatter',
        data: rows
          .filter((row) => row[pitKey])
          .map((row) => [row.lap + (key === 'b' ? 0.18 : -0.18), pitRow]),
        symbol: 'circle',
        symbolSize: 13,
        itemStyle: { color: '#0d1014', borderColor: colour, borderWidth: 2 },
        label: {
          show: true,
          formatter: 'P',
          color: colour,
          fontSize: 8,
          fontWeight: 700,
        },
        tooltip: { show: false },
      },
    ]
    return {
      ...baseOption(rows),
      tooltip: {
        ...baseOption(rows).tooltip,
        formatter: (
          params: { seriesName: string; value: [number, number | null] }[],
        ) => {
          const lines = params
            .filter((item) => !item.seriesName.endsWith('pit'))
            .map((item) => `${item.seriesName} ${lapTime(item.value[1])}`)
          const lap = params[0]?.value[0]
          const row = rows.find((item) => item.lap === lap)
          const note = row?.neutralised
            ? row.neutralised === 'sc'
              ? ' · Safety car'
              : ' · VSC'
            : ''
          return [`Lap ${lap}${note}`, ...lines].join('<br/>')
        },
      },
      yAxis: {
        type: 'value',
        min: pitRow - pad,
        max: top + pad,
        axisLabel: {
          color: AXIS,
          fontSize: 10,
          showMaxLabel: false,
          formatter: (value: number) =>
            value < bottom - pad / 2
              ? ''
              : lapTime(value).replace(/\.\d+$/, ''),
        },
        splitLine: { lineStyle: { color: GRID_LINE } },
      },
      series: [
        ...series(selected?.nameAcronym ?? 'A', 'a', 'pitA', colourA, false),
        ...series(rival?.nameAcronym ?? 'B', 'b', 'pitB', lineB, sameTeam),
      ],
    }
  })()

  const gapOption = (() => {
    // Plotted as "selected driver ahead" so up is good for them.
    const values = rows
      .map((row) => row.gap)
      .filter((value): value is number => value != null)
    const largest = Math.max(1, ...values.map(Math.abs))
    const step =
      [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800].find(
        (size) => largest / size <= 2,
      ) ?? Math.ceil(largest / 2)
    const extent = Math.ceil(largest / step) * step
    return {
      ...baseOption(rows),
      tooltip: {
        ...baseOption(rows).tooltip,
        formatter: (params: { value: [number, number | null] }[]) => {
          const [lap, gap] = params[0]?.value ?? [0, null]
          if (gap == null) return `Lap ${lap} · no gap recorded`
          const ahead = gap > 0 ? selected?.nameAcronym : rival?.nameAcronym
          return `Lap ${lap}<br/>${ahead} ahead by ${Math.abs(gap).toFixed(3)} s`
        },
      },
      yAxis: {
        type: 'value',
        min: -extent,
        max: extent,
        interval: step,
        axisLabel: {
          color: AXIS,
          fontSize: 10,
          formatter: (value: number) =>
            value === 0
              ? '0'
              : `${value > 0 ? '+' : '−'}${Math.abs(value) >= 120 ? `${Math.round(Math.abs(value) / 60)}m` : `${Math.abs(value)}s`}`,
        },
        splitLine: { lineStyle: { color: GRID_LINE } },
      },
      series: [
        {
          name: 'Gap',
          type: 'line',
          data: rows.map((row) => [row.lap, row.gap == null ? null : -row.gap]),
          showSymbol: false,
          lineStyle: { color: colourA, width: 2 },
          areaStyle: { color: colourA, opacity: 0.12, origin: 0 },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: '#4b535e', type: 'solid' },
            data: [{ yAxis: 0 }],
          },
          markArea: { silent: true, data: neutralisedAreas(rows) },
        },
      ],
    }
  })()

  if (!selected) {
    return <p className="race-data-note">Select a driver to compare.</p>
  }

  const rivals = drivers.filter(
    (driver) => driver.driverNumber !== selected.driverNumber,
  )
  const latest = [...rows].reverse().find((row) => row.gap != null)
  // One driver has stopped completing laps (garage, red flag, long stop).
  const lastLap = rows.at(-1)?.lap ?? 0
  const lastLapOf = (key: 'a' | 'b') =>
    [...rows].reverse().find((row) => row[key] != null)?.lap ?? 0
  const stalled =
    !retiree && rival
      ? lastLapOf('a') < lastLap - 1
        ? { driver: selected, lap: lastLapOf('a') }
        : lastLapOf('b') < lastLap - 1
          ? { driver: rival, lap: lastLapOf('b') }
          : null
      : null
  const recent = rows.slice(-8).reverse()
  const bestA = bestSectors(rows, 'a')
  const bestB = bestSectors(rows, 'b')
  const style = { '--a': colourA, '--b': lineB } as CSSProperties

  return (
    <section
      className="compare-panel"
      style={style}
      aria-label="Driver comparison"
    >
      <header className="compare-head">
        <span className="compare-chip" data-side="a">
          {selected.nameAcronym}
        </span>
        <span className="compare-vs">vs</span>
        <label className="compare-rival">
          <span className="visually-hidden">Compare with</span>
          <select
            value={rival?.driverNumber ?? ''}
            onChange={(event) => setPickedRival(Number(event.target.value))}
          >
            {rival ? null : <option value="">Choose driver</option>}
            {rivals.map((driver) => (
              <option key={driver.driverNumber} value={driver.driverNumber}>
                {driver.nameAcronym} · {driver.teamName}
              </option>
            ))}
          </select>
        </label>
        <span className="compare-gap">
          {retiree
            ? `${retiree.nameAcronym} retired · L${retireeLastLap}`
            : stalled
              ? `${stalled.driver.nameAcronym} no lap since L${stalled.lap}`
              : latest?.gap != null
                ? `${latest.gap < 0 ? selected.nameAcronym : rival?.nameAcronym} +${Math.abs(latest.gap).toFixed(1)}s · L${latest.lap}`
                : '—'}
        </span>
      </header>

      {!rival ? (
        <p className="race-data-note">Choose a driver to compare with.</p>
      ) : rows.length === 0 ? (
        <p className="race-data-note">
          No completed laps for both drivers yet at this point in the replay.
        </p>
      ) : (
        <>
          {retiree ? (
            <p className="race-data-note">
              {retiree.nameAcronym} retired (DNF) after lap {retireeLastLap}.
              The comparison ends there.
            </p>
          ) : null}
          <h4 className="compare-title">
            Lap times
            <span className="compare-legend">
              <i data-kind="sc" /> SC / VSC <b>P</b> pit
            </span>
          </h4>
          <EChart
            option={lapOption}
            height={150}
            label={`Lap times of ${selected.nameAcronym} and ${rival.nameAcronym} up to lap ${rows.at(-1)?.lap}`}
          />
          <h4 className="compare-title">
            Gap
            <span className="compare-legend">
              up = {selected.nameAcronym} ahead
            </span>
          </h4>
          <EChart
            option={gapOption}
            height={110}
            label={`Gap between ${selected.nameAcronym} and ${rival.nameAcronym} by lap`}
          />
          <table className="compare-table">
            <caption className="visually-hidden">
              Sector deltas, negative means {selected.nameAcronym} was quicker
            </caption>
            <thead>
              <tr>
                <th scope="col">Lap</th>
                <th scope="col">S1</th>
                <th scope="col">S2</th>
                <th scope="col">S3</th>
                <th scope="col">Lap Δ</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr
                  key={row.lap}
                  data-neutralised={row.neutralised ?? undefined}
                >
                  <th scope="row">
                    {row.lap}
                    {row.pitA || row.pitB ? <small> P</small> : null}
                  </th>
                  {row.aSectors.map((value, index) => {
                    const other = row.bSectors[index]
                    const delta =
                      value != null && other != null ? value - other : null
                    return (
                      <td
                        key={index}
                        data-gain={
                          delta == null
                            ? undefined
                            : delta < 0
                              ? 'a'
                              : delta > 0
                                ? 'b'
                                : undefined
                        }
                      >
                        {signed(delta)}
                      </td>
                    )
                  })}
                  <td
                    data-gain={
                      row.delta == null
                        ? undefined
                        : row.delta < 0
                          ? 'a'
                          : row.delta > 0
                            ? 'b'
                            : undefined
                    }
                  >
                    {signed(row.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(
                [
                  [selected.nameAcronym, bestA, 'a'],
                  [rival.nameAcronym, bestB, 'b'],
                ] as const
              ).map(([name, best, side]) => (
                <tr key={side} data-side={side}>
                  <th scope="row">{name} best</th>
                  {best.map((value, index) => (
                    <td key={index}>
                      {value == null ? '—' : value.toFixed(3)}
                    </td>
                  ))}
                  <td title="Sum of best sectors">
                    {best.every((value) => value != null)
                      ? lapTime(best.reduce((sum, value) => sum! + value!, 0))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
          <p className="telemetry-footnote">
            Deltas: {selected.nameAcronym} minus {rival.nameAcronym}; negative
            means {selected.nameAcronym} was quicker. Only laps completed before
            the playhead are shown.
          </p>
        </>
      )}
    </section>
  )
}
