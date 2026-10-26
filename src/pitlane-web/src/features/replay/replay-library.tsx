import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  Check,
  ChevronRight,
  ExternalLink,
  MapPin,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { WeatherPanel } from '@/features/replay/weather-panel'
import {
  getMeetingSessions,
  getMeetings,
  type Meeting,
  type RaceSession,
} from '@/lib/api'

const currentYear = new Date().getUTCFullYear()
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
    retry: false,
  })
  const meetingKey = selection.meetingKey
  const sessions = useQuery({
    queryKey: ['historical-sessions', meetingKey],
    queryFn: ({ signal }) => getMeetingSessions(meetingKey!, signal),
    enabled: meetingKey !== null,
    staleTime: 30 * 60_000,
    retry: false,
  })
  const visibleMeetings = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return (meetings.data?.items ?? []).filter((meeting) =>
      `${meeting.meetingName} ${meeting.location} ${meeting.countryName} ${meeting.circuitShortName}`
        .toLocaleLowerCase()
        .includes(normalizedSearch),
    )
  }, [meetings.data, search])
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
      <header className="replay-commandbar">
        <div className="replay-command-copy">
          <span className="section-kicker">
            <span /> RACE REPLAY
          </span>
          {selectedSession && selectedMeeting ? (
            <div className="current-event">
              <h1>{selectedMeeting.meetingName}</h1>
              <span>{selectedMeeting.circuitShortName}</span>
              <i />
              <span>{selectedSession.sessionName}</span>
              <small>
                {formatDate(selectedSession.dateStart, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </small>
            </div>
          ) : (
            <div className="current-event">
              <h1>Choose a historical session</h1>
              <span>OpenF1 archive</span>
            </div>
          )}
        </div>
        <Button
          className="session-browser-trigger"
          variant="secondary"
          onClick={() => setBrowserOpen(true)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          {selectedSession ? 'Change session' : 'Browse sessions'}
        </Button>
      </header>

      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent
          className="race-session-dialog"
          aria-describedby="session-browser-description"
        >
          <div className="session-dialog-heading">
            <div>
              <span className="section-kicker">
                <span /> OPENF1 ARCHIVE
              </span>
              <DialogTitle>Find a race weekend</DialogTitle>
              <DialogDescription id="session-browser-description">
                Select a completed session. Replay coverage is checked when you
                open it.
              </DialogDescription>
            </div>
            <label className="season-select">
              SEASON
              <select
                aria-label="Season"
                value={selection.year}
                onChange={(event) =>
                  navigate({
                    year: Number(event.target.value),
                    meetingKey: null,
                    sessionKey: null,
                  })
                }
              >
                {Array.from(
                  { length: currentYear - 2022 },
                  (_, index) => currentYear - index,
                ).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="session-browser-grid">
            <section
              className="meeting-column"
              aria-labelledby="meetings-heading"
            >
              <div className="browser-section-heading">
                <h3 id="meetings-heading">Grand Prix & testing</h3>
                <span>{meetings.data?.items.length ?? '—'}</span>
              </div>
              <label className="meeting-search">
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">Filter meetings</span>
                <input
                  type="search"
                  name="meeting-search"
                  autoComplete="off"
                  placeholder="Find a race or circuit…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {meetings.isPending ? (
                <p className="browser-message" role="status">
                  Loading {selection.year} events…
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
                <p className="browser-message">No events match your search.</p>
              ) : null}
              {meetings.isSuccess ? (
                <ul
                  className="meeting-list"
                  aria-label={`${selection.year} Grand Prix events`}
                >
                  {visibleMeetings.map((meeting) => (
                    <li key={meeting.meetingKey}>
                      <button
                        type="button"
                        className={`meeting-option ${meetingKey === meeting.meetingKey ? 'selected' : ''}`}
                        aria-pressed={meetingKey === meeting.meetingKey}
                        onClick={() => selectMeeting(meeting)}
                      >
                        <span className="meeting-date">
                          {formatDate(meeting.dateStart, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          –
                          {formatDate(meeting.dateEnd, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          {meeting.isCancelled ? ' · Cancelled' : ''}
                        </span>
                        <strong className="meeting-name">
                          {meeting.meetingName}
                        </strong>
                        <span className="meeting-location">
                          <MapPin size={12} aria-hidden="true" />{' '}
                          {meeting.location}, {meeting.countryName}
                        </span>
                        {meetingKey === meeting.meetingKey ? (
                          <Check
                            className="meeting-chevron"
                            size={16}
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronRight
                            className="meeting-chevron"
                            size={16}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {meetings.data ? (
                <p className="source-note">
                  Source{' '}
                  <a
                    href="https://openf1.org/docs/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenF1 <ExternalLink size={11} aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>{' '}
                  · refreshed{' '}
                  {formatDate(meetings.data.retrievedAtUtc, {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  })}
                </p>
              ) : null}
            </section>

            <section
              className="session-column"
              aria-labelledby="sessions-heading"
              aria-live="polite"
            >
              <div className="browser-section-heading">
                <h3 id="sessions-heading">
                  {selectedMeeting?.circuitShortName ?? 'Sessions'}
                </h3>
                <span>{sessions.data?.items.length ?? '—'}</span>
              </div>
              {!selectedMeeting ? (
                <div className="session-empty">
                  <CalendarDays size={22} aria-hidden="true" />
                  <p>
                    Choose an event to see its practice, qualifying, sprint, and
                    race sessions.
                  </p>
                </div>
              ) : null}
              {selectedMeeting?.isCancelled ? (
                <p className="session-empty">This meeting was cancelled.</p>
              ) : null}
              {selectedMeeting && sessions.isPending ? (
                <p className="browser-message" role="status">
                  Loading sessions…
                </p>
              ) : null}
              {selectedMeeting && sessions.isError ? (
                <div className="browser-message" role="alert">
                  <span>{sessions.error.message}</span>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => void sessions.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {selectedMeeting &&
              sessions.isSuccess &&
              sessions.data.items.length === 0 ? (
                <p className="session-empty">
                  OpenF1 lists no sessions for this event.
                </p>
              ) : null}
              {selectedMeeting && sessions.isSuccess ? (
                <div className="session-list">
                  {sessions.data.items.map((session) => (
                    <SessionOption
                      key={session.sessionKey}
                      session={session}
                      selected={session.sessionKey === selection.sessionKey}
                      onSelect={selectSession}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
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
        <section
          className="replay-empty-state"
          aria-labelledby="replay-empty-title"
        >
          <div className="replay-empty-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span className="section-kicker">
            <span /> HISTORICAL TIMING
          </span>
          <h2 id="replay-empty-title">
            Pick a session.
            <br />
            Take your place on the pit wall.
          </h2>
          <p>
            Browse completed Grand Prix sessions. Position, classification, and
            telemetry streams vary by event and are checked when selected.
          </p>
          <Button
            className="session-browser-trigger"
            onClick={() => setBrowserOpen(true)}
          >
            <CalendarDays size={15} aria-hidden="true" /> Browse historical
            sessions
          </Button>
          <small>OpenF1 historical data · sessions from 2023 onward</small>
        </section>
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
  return (
    <button
      type="button"
      className={`session-option ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      disabled={upcoming}
      onClick={() => onSelect(session)}
    >
      <span className="session-type">{session.sessionType || 'Session'}</span>
      <strong>{session.sessionName}</strong>
      <span className="session-time">
        {formatDate(session.dateStart, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>
      <span className={`session-coverage ${upcoming ? 'upcoming' : ''}`}>
        {upcoming ? 'Upcoming' : 'Check replay coverage'}
      </span>
      {selected ? <Check size={15} aria-hidden="true" /> : null}
    </button>
  )
}
