import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  ChevronRight,
  ExternalLink,
  Flag,
  MapPin,
  RotateCcw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getMeetingSessions,
  getMeetings,
  type Meeting,
  type RaceSession,
} from '@/lib/api'

const currentYear = new Date().getUTCFullYear()

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

function meetingDate(meeting: Meeting) {
  return `${formatDate(meeting.dateStart, { month: 'short', day: 'numeric' })}–${formatDate(meeting.dateEnd, { day: 'numeric', year: 'numeric' })}`
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
  const meetings = useQuery({
    queryKey: ['historical-meetings', selection.year],
    queryFn: ({ signal }) => getMeetings(selection.year, signal),
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

  return (
    <section
      className="replay-library panel"
      aria-label="Historical session library"
    >
      <div className="library-header">
        <div>
          <div className="panel-title">
            <RotateCcw size={17} aria-hidden="true" />
            <h2>Choose a historical session</h2>
          </div>
          <p>Browse real event metadata from OpenF1.</p>
        </div>
        <label className="year-picker">
          Season
          <select
            value={selection.year}
            onChange={(event) =>
              navigate({
                year: Number(event.target.value),
                meetingKey: null,
                sessionKey: null,
              })
            }
            aria-label="Season"
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

      <div className="library-columns">
        <section className="meeting-column" aria-labelledby="meetings-heading">
          <div className="list-heading">
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
            <div className="library-message" role="status">
              Loading {selection.year} meetings…
            </div>
          ) : null}
          {meetings.isError ? (
            <div className="library-message library-error" role="alert">
              <span>
                OpenF1 couldn’t load this season. Check your connection and try
                again.
              </span>
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
            <div className="library-message">
              No meetings match that search.
            </div>
          ) : null}
          {meetings.isSuccess && visibleMeetings.length > 0 ? (
            <div
              className="meeting-list"
              role="list"
              aria-label={`${selection.year} meetings`}
            >
              {visibleMeetings.map((meeting) => (
                <button
                  type="button"
                  role="listitem"
                  className={`meeting-option ${meetingKey === meeting.meetingKey ? 'selected' : ''}`}
                  aria-pressed={meetingKey === meeting.meetingKey}
                  key={meeting.meetingKey}
                  onClick={() =>
                    navigate({
                      year: selection.year,
                      meetingKey: meeting.meetingKey,
                      sessionKey: null,
                    })
                  }
                >
                  <span className="meeting-date">
                    {meetingDate(meeting)}
                    {meeting.isCancelled ? ' · Cancelled' : ''}
                  </span>
                  <span className="meeting-name">{meeting.meetingName}</span>
                  <span className="meeting-location">
                    <MapPin size={12} aria-hidden="true" /> {meeting.location},{' '}
                    {meeting.countryName}
                  </span>
                  <ChevronRight
                    size={15}
                    className="meeting-chevron"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ) : null}
          {meetings.data ? (
            <p className="source-note">
              Source:{' '}
              <a
                href="https://openf1.org/docs/"
                target="_blank"
                rel="noreferrer"
              >
                OpenF1 <ExternalLink size={11} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>{' '}
              · updated{' '}
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
          <div className="list-heading">
            <h3 id="sessions-heading">
              {selectedMeeting ? selectedMeeting.circuitShortName : 'Sessions'}
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
            <div className="session-empty">
              <p>
                This meeting was cancelled. OpenF1 lists no confirmed sessions.
              </p>
            </div>
          ) : null}
          {selectedMeeting &&
          !selectedMeeting.isCancelled &&
          sessions.isPending ? (
            <div className="library-message" role="status">
              Loading sessions…
            </div>
          ) : null}
          {selectedMeeting && sessions.isError ? (
            <div className="library-message library-error" role="alert">
              <span>Sessions could not be loaded.</span>
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
            <div className="session-empty">
              <p>OpenF1 lists no sessions for this meeting.</p>
            </div>
          ) : null}
          {selectedMeeting &&
          sessions.isSuccess &&
          sessions.data.items.length > 0 ? (
            <div className="session-list">
              {sessions.data.items.map((session) => (
                <SessionOption
                  key={session.sessionKey}
                  session={session}
                  selected={session.sessionKey === selection.sessionKey}
                  year={selection.year}
                  meetingKey={selectedMeeting.meetingKey}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <div
        className={`selection-footer ${selectedSession ? 'has-selection' : ''}`}
        aria-live="polite"
      >
        {selectedSession && selectedMeeting ? (
          <>
            <div>
              <Flag size={16} aria-hidden="true" />
              <span>
                <strong>
                  {selectedMeeting.meetingName} · {selectedSession.sessionName}
                </strong>
                <small>
                  Selected from OpenF1 · replay data has not been checked yet
                </small>
              </span>
            </div>
            <span className="selection-time">
              {formatDate(selectedSession.dateStart, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
          </>
        ) : (
          <p>
            Session metadata is available here. Position and timing coverage
            will be checked when replay is built.
          </p>
        )}
      </div>
    </section>
  )
}

function SessionOption({
  session,
  selected,
  year,
  meetingKey,
}: {
  session: RaceSession
  selected: boolean
  year: number
  meetingKey: number
}) {
  return (
    <button
      type="button"
      className={`session-option ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={() =>
        navigate({ year, meetingKey, sessionKey: session.sessionKey })
      }
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
    </button>
  )
}
