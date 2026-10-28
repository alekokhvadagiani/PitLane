import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Check, ExternalLink, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { WeatherPanel } from '@/features/replay/weather-panel'
import { SeasonHome } from '@/features/replay/season-home'
import { numberRounds, seasons } from '@/features/replay/season'
import {
  getMeetingSessions,
  getMeetings,
  type Meeting,
  type RaceSession,
} from '@/lib/api'

const pageLoadedAtMs = Date.now()
const RaceReplay = lazy(() =>
  import('@/features/replay/race-replay').then((module) => ({
    default: module.RaceReplay,
  })),
)
const LapReplay = lazy(() =>
  import('@/features/replay/lap-replay').then((module) => ({
    default: module.LapReplay,
  })),
)

export type ReplaySelection = {
  year: number
  meetingKey: number | null
  sessionKey: number | null
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, options).format(date)
}

function formatRange(start: string, end: string) {
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).formatRange(from, to)
}

function navigate(selection: ReplaySelection) {
  const parameters = new URLSearchParams({ year: String(selection.year) })
  if (selection.meetingKey !== null)
    parameters.set('meeting', String(selection.meetingKey))
  if (selection.sessionKey !== null)
    parameters.set('session', String(selection.sessionKey))
  location.hash = `replay?${parameters}`
}

export function ReplayLibrary({ selection }: { selection: ReplaySelection }) {
  const [search, setSearch] = useState('')
  const [browserOpen, setBrowserOpen] = useState(false)
  const meetings = useQuery({
    queryKey: ['historical-meetings', selection.year],
    queryFn: ({ signal }) => getMeetings(selection.year, signal),
    enabled: browserOpen || selection.meetingKey !== null,
    staleTime: 30 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const meetingKey = selection.meetingKey
  const sessions = useQuery({
    queryKey: ['historical-sessions', meetingKey],
    queryFn: ({ signal }) => getMeetingSessions(meetingKey!, signal),
    enabled: meetingKey !== null,
    staleTime: 30 * 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const rounds = useMemo(
    () => numberRounds(meetings.data?.items ?? []),
    [meetings.data],
  )
  const visibleMeetings = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return rounds.filter(({ meeting }) =>
      `${meeting.meetingName} ${meeting.location} ${meeting.countryName} ${meeting.circuitShortName}`
        .toLocaleLowerCase()
        .includes(normalizedSearch),
    )
  }, [rounds, search])
  // Open the sheet on the chosen round, or on the latest one already run.
  const anchorKey =
    meetingKey ??
    rounds.findLast(
      ({ meeting }) => Date.parse(meeting.dateStart) <= pageLoadedAtMs,
    )?.meeting.meetingKey
  const selectedMeeting = meetings.data?.items.find(
    (meeting) => meeting.meetingKey === meetingKey,
  )
  const selectedSession = sessions.data?.items.find(
    (session) => session.sessionKey === selection.sessionKey,
  )
  const sessionStart = selectedSession
    ? Date.parse(selectedSession.dateStart)
    : NaN
  const isUpcoming =
    Number.isFinite(sessionStart) && sessionStart > pageLoadedAtMs

  function selectMeeting(meeting: Meeting) {
    navigate({
      year: selection.year,
      meetingKey: meeting.meetingKey,
      sessionKey: null,
    })
  }

  function selectSession(session: RaceSession) {
    if (Date.parse(session.dateStart) > Date.now()) return
    navigate({
      year: selection.year,
      meetingKey: session.meetingKey,
      sessionKey: session.sessionKey,
    })
    setBrowserOpen(false)
  }

  return (
    <section className="replay-mode" aria-label="Race replay workspace">
      {selectedSession && selectedMeeting ? (
        <header className="replay-commandbar">
          <div className="current-event">
            <h1>{selectedMeeting.meetingName}</h1>
            <p>
              <span>{selectedSession.sessionName}</span>
              <span>{selectedMeeting.circuitShortName}</span>
              <span>
                {formatDate(selectedSession.dateStart, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </p>
          </div>
          <Button
            className="session-browser-trigger"
            variant="secondary"
            onClick={() => setBrowserOpen(true)}
          >
            <CalendarDays size={15} aria-hidden="true" />
            Change session
          </Button>
        </header>
      ) : null}

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent
          className="race-session-dialog"
          aria-describedby="session-browser-description"
        >
          <div className="season-sheet-head">
            <DialogTitle className="season-title">Choose a session</DialogTitle>
            <div className="season-tabs" role="group" aria-label="Season">
              {seasons.map((year) => (
                <button
                  key={year}
                  type="button"
                  aria-pressed={year === selection.year}
                  onClick={() =>
                    navigate({ year, meetingKey: null, sessionKey: null })
                  }
                >
                  {year}
                </button>
              ))}
            </div>
            <DialogDescription
              id="session-browser-description"
              className="sr-only"
            >
              Pick a round, then one of its completed sessions.
            </DialogDescription>
          </div>
          <label className="meeting-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Filter rounds</span>
            <input
              type="search"
              name="meeting-search"
              autoComplete="off"
              placeholder="Search races, circuits or countries"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="season-rounds" aria-live="polite">
            {meetings.isPending ? (
              <p className="browser-message" role="status">
                Loading the {selection.year} calendar…
              </p>
            ) : null}
            {meetings.isError ? (
              <div className="browser-message" role="alert">
                <span>{meetings.error.message}</span>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => void meetings.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {meetings.isSuccess && visibleMeetings.length === 0 ? (
              <p className="browser-message">
                {search
                  ? `Nothing in ${selection.year} matches “${search.trim()}”.`
                  : `OpenF1 lists no events for ${selection.year} yet.`}
              </p>
            ) : null}
            {meetings.isSuccess ? (
              <ol
                className="meeting-list"
                aria-label={`${selection.year} calendar`}
              >
                {visibleMeetings.map(({ meeting, round }) => {
                  const open = meetingKey === meeting.meetingKey
                  const upcoming =
                    Date.parse(meeting.dateStart) > pageLoadedAtMs
                  return (
                    <li
                      key={meeting.meetingKey}
                      data-open={open || undefined}
                      data-cancelled={meeting.isCancelled || undefined}
                      data-upcoming={upcoming || undefined}
                      ref={
                        meeting.meetingKey === anchorKey
                          ? (element) =>
                              element?.scrollIntoView({ block: 'center' })
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        className="meeting-option"
                        aria-expanded={open}
                        onClick={() => selectMeeting(meeting)}
                      >
                        <span className="meeting-round">{round}</span>
                        <strong className="meeting-name">
                          {meeting.meetingName}
                        </strong>
                        <span className="meeting-location">
                          {meeting.location}, {meeting.countryName}
                        </span>
                        <span className="meeting-date">
                          {meeting.isCancelled
                            ? 'Cancelled'
                            : formatRange(meeting.dateStart, meeting.dateEnd)}
                        </span>
                      </button>
                      {open ? (
                        <div className="meeting-sessions">
                          {meeting.isCancelled ? (
                            <p>This round was cancelled.</p>
                          ) : sessions.isPending ? (
                            <p role="status">Loading sessions…</p>
                          ) : sessions.isError ? (
                            <p role="alert">
                              {sessions.error.message}{' '}
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => void sessions.refetch()}
                              >
                                Retry
                              </Button>
                            </p>
                          ) : sessions.data?.items.length === 0 ? (
                            <p>OpenF1 lists no sessions for this round.</p>
                          ) : (
                            <div className="session-list">
                              {sessions.data?.items.map((session) => (
                                <SessionOption
                                  key={session.sessionKey}
                                  session={session}
                                  selected={
                                    session.sessionKey === selection.sessionKey
                                  }
                                  onSelect={selectSession}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            ) : null}
          </div>
          {meetings.data ? (
            <p className="source-note">
              Calendar from{' '}
              <a
                href="https://openf1.org/docs/"
                target="_blank"
                rel="noreferrer"
              >
                OpenF1 <ExternalLink size={11} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              , refreshed{' '}
              {formatDate(meetings.data.retrievedAtUtc, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      {selectedSession ? (
        <>
          {isUpcoming ? (
            <div className="replay-availability" role="status">
              This session has not started yet. Historical replay data is not
              available until the session is recorded.
            </div>
          ) : null}
          <div id="race-view" className="race-view-anchor" tabIndex={-1}>
            <Suspense
              fallback={
                <div className="race-load-state" role="status">
                  Loading race replay…
                </div>
              }
            >
              <RaceReplay
                key={selectedSession.sessionKey}
                session={selectedSession}
              />
            </Suspense>
          </div>
          <details className="replay-secondary-panel">
            <summary>
              Lap analysis <span>Individual lap trace and sector timing</span>
            </summary>
            <Suspense
              fallback={
                <p className="race-load-state">Loading lap analysis…</p>
              }
            >
              <LapReplay session={selectedSession} />
            </Suspense>
          </details>
          <details className="replay-secondary-panel weather-disclosure">
            <summary>
              Session weather <span>Timestamped OpenF1 observations</span>
            </summary>
            <WeatherPanel session={selectedSession} />
          </details>
        </>
      ) : (
        <SeasonHome
          year={selection.year}
          onYear={(year) =>
            navigate({ year, meetingKey: null, sessionKey: null })
          }
          onOpenRound={(meeting) => {
            selectMeeting(meeting)
            setBrowserOpen(true)
          }}
          onOpenSession={selectSession}
          onBrowse={() => setBrowserOpen(true)}
        />
      )}
    </section>
  )
}

function SessionOption({
  session,
  selected,
  onSelect,
}: {
  session: RaceSession
  selected: boolean
  onSelect: (session: RaceSession) => void
}) {
  const upcoming = Date.parse(session.dateStart) > pageLoadedAtMs
  const main = /^(race|sprint)$/i.test(session.sessionName)
  return (
    <button
      type="button"
      className="session-option"
      data-main={main || undefined}
      aria-pressed={selected}
      disabled={upcoming}
      onClick={() => onSelect(session)}
    >
      <strong>{session.sessionName}</strong>
      <span className="session-time">
        {upcoming
          ? 'Upcoming'
          : formatDate(session.dateStart, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
      </span>
      {selected ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  )
}
