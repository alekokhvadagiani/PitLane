import { useQuery } from '@tanstack/react-query'
import {
  getMeetingSessions,
  getMeetings,
  getSessionDrivers,
  getSessionResults,
  type HistoricalDriver,
  type Meeting,
} from '@/lib/api'

const currentYear = new Date().getUTCFullYear()
const loadedAtMs = Date.now()

export const seasons = Array.from(
  { length: currentYear - 2022 },
  (_, index) => 2023 + index,
)

const cache = {
  staleTime: 30 * 60_000,
  gcTime: 15 * 60_000,
  refetchOnWindowFocus: false,
  retry: false,
} as const

export type SeasonRound = { meeting: Meeting; round: string }

/** Calendar order with round numbers; testing and cancelled events get none. */
export function numberRounds(meetings: Meeting[]): SeasonRound[] {
  let round = 0
  return [...meetings]
    .sort((a, b) => Date.parse(a.dateStart) - Date.parse(b.dateStart))
    .map((meeting) => ({
      meeting,
      round: /testing/i.test(meeting.meetingName)
        ? 'Test'
        : meeting.isCancelled
          ? '–'
          : `R${++round}`,
    }))
}

export function useSeasonMeetings(year: number, enabled = true) {
  return useQuery({
    queryKey: ['historical-meetings', year],
    queryFn: ({ signal }) => getMeetings(year, signal),
    enabled,
    ...cache,
  })
}

/** Grands Prix of a season split into finished and next, by calendar dates. */
export function seasonState(meetings: Meeting[]) {
  const rounds = numberRounds(meetings)
  const grandsPrix = rounds.filter(
    ({ meeting, round }) => round.startsWith('R') && !meeting.isCancelled,
  )
  const finished = grandsPrix.filter(
    ({ meeting }) => Date.parse(meeting.dateEnd) < loadedAtMs,
  )
  return {
    rounds,
    grandsPrix,
    finished,
    latest: finished.at(-1),
    next: grandsPrix.find(
      ({ meeting }) => Date.parse(meeting.dateEnd) >= loadedAtMs,
    ),
  }
}

export type PodiumPlace = {
  position: number
  driverNumber: number
  driver?: HistoricalDriver
}

/** The race session of a meeting and its recorded top three. */
export function useRacePodium(meeting: Meeting | undefined) {
  const sessions = useQuery({
    queryKey: ['historical-sessions', meeting?.meetingKey],
    queryFn: ({ signal }) => getMeetingSessions(meeting!.meetingKey, signal),
    enabled: meeting !== undefined,
    ...cache,
  })
  const race = sessions.data?.items.findLast(
    (session) => session.sessionName === 'Race',
  )
  const results = useQuery({
    queryKey: ['historical-results', race?.sessionKey],
    queryFn: ({ signal }) => getSessionResults(race!.sessionKey, signal),
    enabled: race !== undefined,
    ...cache,
  })
  const drivers = useQuery({
    queryKey: ['historical-drivers', race?.sessionKey],
    queryFn: ({ signal }) => getSessionDrivers(race!.sessionKey, signal),
    enabled: race !== undefined,
    ...cache,
  })
  const byNumber = new Map(
    (drivers.data?.items ?? []).map((driver) => [driver.driverNumber, driver]),
  )
  const podium: PodiumPlace[] = (results.data?.items ?? [])
    .filter((result) => result.position !== null && result.position <= 3)
    .sort((a, b) => a.position! - b.position!)
    .map((result) => ({
      position: result.position!,
      driverNumber: result.driverNumber,
      driver: byNumber.get(result.driverNumber),
    }))
  return {
    race,
    podium,
    pending: sessions.isPending || (race !== undefined && results.isPending),
  }
}

export function teamHex(driver?: HistoricalDriver) {
  return driver && /^[0-9a-f]{6}$/i.test(driver.teamColour)
    ? `#${driver.teamColour}`
    : '#a3a8af'
}

export function replayHash(
  year: number,
  meetingKey?: number,
  sessionKey?: number,
) {
  const parameters = new URLSearchParams({ year: String(year) })
  if (meetingKey !== undefined) parameters.set('meeting', String(meetingKey))
  if (sessionKey !== undefined) parameters.set('session', String(sessionKey))
  return `#replay?${parameters}`
}

export function formatDays(start: string, end: string) {
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).formatRange(from, to)
}

export function daysUntil(value: string) {
  const days = Math.ceil((Date.parse(value) - loadedAtMs) / 86_400_000)
  return days <= 1 ? 'This weekend' : `In ${days} days`
}

export function hasStarted(meeting: Meeting) {
  return Date.parse(meeting.dateStart) <= loadedAtMs
}
