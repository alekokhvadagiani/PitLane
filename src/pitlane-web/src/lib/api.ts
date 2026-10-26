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

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`API returned ${response.status}`)
  return (await response.json()) as T
}
