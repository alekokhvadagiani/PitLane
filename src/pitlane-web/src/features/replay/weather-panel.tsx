import { useQuery } from '@tanstack/react-query'
import { CloudSun, Droplets, Gauge, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getSessionWeather,
  type RaceSession,
  type WeatherObservation,
} from '@/lib/api'

function formatValue(value: number | null, suffix: string, digits = 0) {
  return value === null ? '—' : `${value.toFixed(digits)}${suffix}`
}

function compassDirection(degrees: number | null) {
  if (degrees === null) return '—'
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
    Math.round(degrees / 45) % 8
  ]
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(date)
}

function temperaturePaths(
  observations: WeatherObservation[],
  key: 'airTemperature' | 'trackTemperature',
) {
  const values = observations
    .map((observation) => observation[key])
    .filter((value): value is number => value !== null)
  if (values.length < 2) return []

  const maximum = Math.max(...values)
  const min = Math.min(...values) - 1
  const range = maximum - min + 1
  const paths: string[] = []
  let points: string[] = []
  observations.forEach((observation, index) => {
    const value = observation[key]
    if (value === null) {
      if (points.length > 1) paths.push(points.join(' '))
      points = []
      return
    }
    const x = 18 + (index / Math.max(observations.length - 1, 1)) * 564
    const y = 8 + ((maximum - value) / range) * 52
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  })
  if (points.length > 1) paths.push(points.join(' '))
  return paths
}

export function WeatherPanel({ session }: { session: RaceSession }) {
  const weather = useQuery({
    queryKey: ['historical-weather', session.sessionKey],
    queryFn: ({ signal }) => getSessionWeather(session.sessionKey, signal),
    staleTime: 30 * 60_000,
    retry: false,
  })
  const observations = weather.data?.items ?? []
  const latest = observations.at(-1)
  const trackPaths = temperaturePaths(observations, 'trackTemperature')
  const airPaths = temperaturePaths(observations, 'airTemperature')

  return (
    <section className="weather-panel" aria-labelledby="weather-heading">
      <div className="weather-heading">
        <div className="weather-title">
          <CloudSun size={18} aria-hidden="true" />
          <div>
            <h3 id="weather-heading">Session weather</h3>
            <p>OpenF1 track observations · UTC</p>
          </div>
        </div>
        {latest ? (
          <span className="weather-updated">
            Latest · {formatTime(latest.date)}
          </span>
        ) : null}
      </div>

      {weather.isPending ? (
        <div className="weather-message" role="status">
          Loading session weather…
        </div>
      ) : null}
      {weather.isError ? (
        <div className="weather-message weather-error" role="alert">
          <span>Weather observations could not be loaded.</span>
          <Button
            size="small"
            variant="secondary"
            onClick={() => void weather.refetch()}
          >
            <RotateCw size={13} aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : null}
      {weather.isSuccess && observations.length === 0 ? (
        <div className="weather-message">
          OpenF1 has no weather observations for this session.
        </div>
      ) : null}
      {latest ? (
        <>
          <div
            className="weather-readings"
            aria-label="Latest weather readings"
          >
            <div className="weather-reading weather-primary">
              <span>Track</span>
              <strong>{formatValue(latest.trackTemperature, '°C', 1)}</strong>
            </div>
            <div className="weather-reading">
              <span>Air</span>
              <strong>{formatValue(latest.airTemperature, '°C', 1)}</strong>
            </div>
            <div className="weather-reading">
              <span>Humidity</span>
              <strong>{formatValue(latest.humidity, '%')}</strong>
            </div>
            <div className="weather-reading">
              <span>Wind</span>
              <strong>
                {formatValue(latest.windSpeed, ' m/s', 1)}{' '}
                <small>{compassDirection(latest.windDirection)}</small>
              </strong>
            </div>
            <div className="weather-reading weather-rain">
              <span>Rainfall</span>
              <strong>
                <Droplets size={14} aria-hidden="true" />{' '}
                {latest.rainfall === null
                  ? '—'
                  : latest.rainfall > 0
                    ? 'Recorded'
                    : 'None recorded'}
              </strong>
            </div>
            <div className="weather-reading">
              <span>Pressure</span>
              <strong>{formatValue(latest.pressure, ' mbar', 1)}</strong>
            </div>
          </div>

          <div className="weather-history">
            <div className="weather-history-label">
              <span>
                <Gauge size={13} aria-hidden="true" /> Temperature history
              </span>
              <span>
                {observations.length} observations · about 1 min apart
              </span>
            </div>
            {trackPaths.length > 0 || airPaths.length > 0 ? (
              <svg
                className="weather-chart"
                viewBox="0 0 600 68"
                role="img"
                aria-label={`Air and track temperature history across ${observations.length} weather observations`}
                preserveAspectRatio="none"
              >
                <line x1="18" y1="62" x2="582" y2="62" />
                {airPaths.map((points, index) => (
                  <polyline
                    key={`air-${index}`}
                    className="air-line"
                    points={points}
                  />
                ))}
                {trackPaths.map((points, index) => (
                  <polyline
                    key={`track-${index}`}
                    className="track-line"
                    points={points}
                  />
                ))}
              </svg>
            ) : (
              <div className="weather-message weather-chart-empty">
                Not enough temperature readings to show a history.
              </div>
            )}
            <div className="weather-chart-legend">
              <span>
                <i className="legend-track" /> Track temperature
              </span>
              <span>
                <i className="legend-air" /> Air temperature
              </span>
              <span>Latest {formatTime(latest.date)}</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
