export type Mode = 'live' | 'replay' | 'telemetry' | 'radio'
export type Capabilities = {
  stage: string
  modes: { id: Mode; status: string; reason: string }[]
}
export type HistoricalCatalog<T> = {
  source: string
  retrievedAtUtc: string
  items: T[]
}
export type Meeting = {
  meetingKey: number
  meetingName: string
  location: string
  countryName: string
  circuitShortName: string
  year: number
  dateStart: string
  dateEnd: string
  isCancelled: boolean
}
export type RaceSession = {
  sessionKey: number
  meetingKey: number
  sessionName: string
  sessionType: string
  dateStart: string
  dateEnd: string | null
}
export type WeatherObservation = {
  date: string
  airTemperature: number | null
  trackTemperature: number | null
  humidity: number | null
  pressure: number | null
  rainfall: number | null
  windSpeed: number | null
  windDirection: number | null
}
export type HistoricalDriver = {
  driverNumber: number
  fullName: string
  nameAcronym: string
  teamName: string
  teamColour: string
  /** Official headshot from OpenF1, or null when absent/invalid. */
  headshotUrl?: string | null
}
export type HistoricalLap = {
  lapNumber: number
  dateStart: string | null
  lapDuration: number | null
  sector1Duration: number | null
  sector2Duration: number | null
  sector3Duration: number | null
  isPitOutLap: boolean | null
  driverNumber: number
}
export type HistoricalStint = {
  driverNumber: number
  stintNumber: number
  compound: string | null
  lapStart: number | null
  lapEnd: number | null
  tyreAgeAtStart: number | null
}
export type HistoricalPitStop = {
  date: string
  driverNumber: number
  lapNumber: number | null
  laneDuration: number | null
}
export type HistoricalInterval = {
  date: string
  driverNumber: number
  gapToLeaderSeconds: number | null
  gapToLeaderLaps: number | null
  intervalSeconds: number | null
  intervalLaps: number | null
}
export type HistoricalRaceControlMessage = {
  date: string
  category: string | null
  flag: string | null
  scope: string | null
  /** Marshal sector (not one of the three timing sectors). */
  sector?: number | null
  message: string
  driverNumber: number | null
  lapNumber: number | null
}
export type HistoricalSessionResult = {
  driverNumber: number
  dnf: boolean
  dns: boolean
  dsq: boolean
  position: number | null
  numberOfLaps: number | null
}
export type HistoricalPosition = {
  date: string
  x: number | null
  y: number | null
  z: number | null
  driverNumber: number
}
export type HistoricalClassificationChange = {
  date: string
  driverNumber: number
  position: number
}
export type HistoricalCarSample = {
  date: string
  driverNumber: number
  speed: number | null
  throttle: number | null
  brake: number | null
  rpm: number | null
  gear: number | null
  drs: number | null
}

export async function getCapabilities(
  signal: AbortSignal,
): Promise<Capabilities> {
  return getJson('/api/capabilities', signal)
}

export function getMeetings(year: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<Meeting>>(
    `/api/meetings?year=${year}`,
    signal,
  )
}

export function getMeetingSessions(meetingKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<RaceSession>>(
    `/api/meetings/${meetingKey}/sessions`,
    signal,
  )
}

export function getSessionWeather(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<WeatherObservation>>(
    `/api/sessions/${sessionKey}/weather`,
    signal,
  )
}

export function getSessionDrivers(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalDriver>>(
    `/api/sessions/${sessionKey}/drivers`,
    signal,
  )
}

export function getDriverLaps(
  sessionKey: number,
  driverNumber: number,
  signal: AbortSignal,
) {
  return getJson<HistoricalCatalog<HistoricalLap>>(
    `/api/sessions/${sessionKey}/laps?driverNumber=${driverNumber}`,
    signal,
  )
}

export function getSessionLaps(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalLap>>(
    `/api/sessions/${sessionKey}/all-laps`,
    signal,
  )
}

export function getSessionStints(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalStint>>(
    `/api/sessions/${sessionKey}/stints`,
    signal,
  )
}

export function getSessionPitStops(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalPitStop>>(
    `/api/sessions/${sessionKey}/pit-stops`,
    signal,
  )
}

export function getIntervals(
  sessionKey: number,
  fromUtc: string,
  toUtc: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ fromUtc, toUtc })
  return getJson<HistoricalCatalog<HistoricalInterval>>(
    `/api/sessions/${sessionKey}/intervals?${query}`,
    signal,
  )
}

export function getRaceControl(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalRaceControlMessage>>(
    `/api/sessions/${sessionKey}/race-control`,
    signal,
  )
}

export function getSessionResults(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalSessionResult>>(
    `/api/sessions/${sessionKey}/results`,
    signal,
  )
}

export function getDriverPositions(
  sessionKey: number,
  driverNumber: number,
  fromUtc: string,
  toUtc: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({
    driverNumber: String(driverNumber),
    fromUtc,
    toUtc,
  })
  return getJson<HistoricalCatalog<HistoricalPosition>>(
    `/api/sessions/${sessionKey}/positions?${query}`,
    signal,
  )
}

export function getRacePositions(
  sessionKey: number,
  fromUtc: string,
  toUtc: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ fromUtc, toUtc })
  return getJson<HistoricalCatalog<HistoricalPosition>>(
    `/api/sessions/${sessionKey}/race-positions?${query}`,
    signal,
  )
}

export function getClassification(sessionKey: number, signal: AbortSignal) {
  return getJson<HistoricalCatalog<HistoricalClassificationChange>>(
    `/api/sessions/${sessionKey}/classification`,
    signal,
  )
}

export function getCarData(
  sessionKey: number,
  driverNumber: number,
  fromUtc: string,
  toUtc: string,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({
    driverNumber: String(driverNumber),
    fromUtc,
    toUtc,
  })
  return getJson<HistoricalCatalog<HistoricalCarSample>>(
    `/api/sessions/${sessionKey}/car-data?${query}`,
    signal,
  )
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  const response = await fetch(url, { signal: requestSignal })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const problem =
      typeof body === 'object' && body !== null
        ? (body as { detail?: unknown; title?: unknown })
        : null
    const detail =
      typeof problem?.detail === 'string'
        ? problem.detail
        : typeof problem?.title === 'string'
          ? problem.title
          : `API returned ${response.status}`
    throw new Error(detail)
  }
  return (await response.json()) as T
}
