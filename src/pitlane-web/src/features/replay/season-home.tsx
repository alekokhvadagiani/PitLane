import type { CSSProperties } from 'react'
import { CalendarDays, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { circuitOutline, countryLook } from '@/features/replay/countries'
import {
  daysUntil,
  formatDays as range,
  hasStarted,
  seasons,
  seasonState,
  teamHex,
  useRacePodium,
  useSeasonMeetings,
  type PodiumPlace,
  type SeasonRound,
} from '@/features/replay/season'
import type { Meeting, RaceSession } from '@/lib/api'

function lookStyle(meeting: Meeting) {
  const [first, second] = countryLook(meeting.countryName).colours
  return { '--flag-a': first, '--flag-b': second } as CSSProperties
}

export function Flag({ meeting }: { meeting: Meeting }) {
  const { flag } = countryLook(meeting.countryName)
  return flag ? (
    <img className="flag" src={flag} alt={meeting.countryName} />
  ) : null
}

/** Recorded circuit outline; nothing is drawn when no lap was traced. */
export function TrackShape({
  name,
  className = 'round-card-track',
}: {
  name: string
  className?: string
}) {
  const path = circuitOutline(name)
  return (
    <svg className={className} viewBox="-6 -6 112 112" aria-hidden="true">
      {path ? <path d={path} pathLength={1} /> : null}
    </svg>
  )
}

/** A calendar round with its flag, recorded circuit and dates. */
export function RoundCard({
  entry: { meeting, round },
  latest,
  onOpen,
}: {
  entry: SeasonRound
  latest?: boolean
  onOpen: (meeting: Meeting) => void
}) {
  const done = hasStarted(meeting)
  return (
    <button
      type="button"
      className="round-card"
      data-state={meeting.isCancelled ? 'cancelled' : done ? 'done' : 'later'}
      data-latest={latest || undefined}
      disabled={!done || meeting.isCancelled}
      onClick={() => onOpen(meeting)}
      style={lookStyle(meeting)}
    >
      <span className="round-card-top">
        <span className="round-card-number">{round}</span>
        <Flag meeting={meeting} />
      </span>
      <TrackShape name={meeting.circuitShortName} />
      <strong>{meeting.meetingName}</strong>
      <span>{meeting.location}</span>
      <small>
        {meeting.isCancelled
          ? 'Cancelled'
          : done
            ? range(meeting.dateStart, meeting.dateEnd)
            : daysUntil(meeting.dateStart)}
      </small>
    </button>
  )
}

export function Podium({
  podium,
  pending,
}: {
  podium: PodiumPlace[]
  pending: boolean
}) {
  return (
    <ol className="podium" aria-label="Podium">
      {podium.length === 0 ? (
        <li className="podium-empty">
          {pending ? 'Loading result…' : 'No classified result recorded.'}
        </li>
      ) : (
        podium.map(({ position, driverNumber, driver }) => (
          <li
            key={driverNumber}
            style={{ '--team': teamHex(driver) } as CSSProperties}
          >
            <span className="podium-pos">{position}</span>
            {driver?.headshotUrl ? (
              <img src={driver.headshotUrl} alt="" loading="lazy" />
            ) : (
              <span className="podium-face" />
            )}
            <span className="podium-name">
              <strong>{driver?.fullName ?? `#${driverNumber}`}</strong>
              <small>{driver?.teamName ?? ''}</small>
            </span>
          </li>
        ))
      )}
    </ol>
  )
}

/**
 * Replay landing page: the latest race with its podium, the season so far
 * and every round of the chosen year. Only recorded results are shown.
 */
export function SeasonHome({
  year,
  onYear,
  onOpenRound,
  onOpenSession,
  onBrowse,
}: {
  year: number
  onYear: (year: number) => void
  onOpenRound: (meeting: Meeting) => void
  onOpenSession: (session: RaceSession) => void
  onBrowse: () => void
}) {
  const meetings = useSeasonMeetings(year)
  const { rounds, grandsPrix, finished, latest, next } = seasonState(
    meetings.data?.items ?? [],
  )

  return (
    <section className="season-home" aria-labelledby="season-home-title">
      <header className="season-home-head">
        <div>
          <h2 id="season-home-title">Pick a race to replay.</h2>
          <p>
            Car positions, timing, telemetry and team radio from every session
            OpenF1 recorded since 2023.
          </p>
        </div>
        <div className="season-home-tools">
          <div className="season-tabs" role="group" aria-label="Season">
            {seasons.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === year}
                onClick={() => onYear(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={onBrowse}>
            <CalendarDays size={15} aria-hidden="true" /> Browse sessions
          </Button>
        </div>
      </header>

      {meetings.isPending ? (
        <p className="season-note" role="status">
          Loading the {year} calendar…
        </p>
      ) : null}
      {meetings.isError ? (
        <div className="season-note" role="alert">
          {meetings.error.message}
          <Button
            size="small"
            variant="secondary"
            onClick={() => void meetings.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {meetings.isSuccess ? (
        <>
          <div className="season-lead">
            {latest ? (
              <LatestRace
                entry={latest}
                onOpenRound={onOpenRound}
                onOpenSession={onOpenSession}
              />
            ) : (
              <div className="latest-race latest-empty">
                <p>No {year} Grand Prix has finished yet.</p>
              </div>
            )}
            <aside className="season-progress" aria-label="Season progress">
              <p className="season-progress-count">
                <strong>{finished.length}</strong>
                <span>of {grandsPrix.length} rounds run</span>
              </p>
              <ol className="season-ticks" aria-hidden="true">
                {grandsPrix.map(({ meeting }) => (
                  <li
                    key={meeting.meetingKey}
                    data-state={
                      finished.some((done) => done.meeting === meeting)
                        ? 'done'
                        : meeting.meetingKey === next?.meeting.meetingKey
                          ? 'next'
                          : 'later'
                    }
                  />
                ))}
              </ol>
              {next ? (
                <div className="season-next" style={lookStyle(next.meeting)}>
                  <TrackShape
                    name={next.meeting.circuitShortName}
                    className="season-next-track"
                  />
                  <span className="season-next-label">
                    <Flag meeting={next.meeting} /> Next race,{' '}
                    {daysUntil(next.meeting.dateStart).toLowerCase()}
                  </span>
                  <strong>{next.meeting.meetingName}</strong>
                  <small>
                    {next.meeting.location},{' '}
                    {range(next.meeting.dateStart, next.meeting.dateEnd)}
                  </small>
                </div>
              ) : (
                <div className="season-next">
                  <strong>Season complete</strong>
                </div>
              )}
            </aside>
          </div>

          <ol className="season-grid" aria-label={`${year} calendar`}>
            {rounds.map((entry) => (
              <li key={entry.meeting.meetingKey}>
                <RoundCard
                  entry={entry}
                  latest={entry.meeting === latest?.meeting}
                  onOpen={onOpenRound}
                />
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  )
}

function LatestRace({
  entry,
  onOpenRound,
  onOpenSession,
}: {
  entry: SeasonRound
  onOpenRound: (meeting: Meeting) => void
  onOpenSession: (session: RaceSession) => void
}) {
  const { meeting, round } = entry
  const { race, podium, pending } = useRacePodium(meeting)
  const winner = podium[0]?.driver

  return (
    <article
      className="latest-race"
      style={
        { '--winner': teamHex(winner), ...lookStyle(meeting) } as CSSProperties
      }
      aria-label={`Latest race: ${meeting.meetingName}`}
    >
      <TrackShape name={meeting.circuitShortName} className="latest-track" />
      <div className="latest-copy">
        <p className="latest-label">
          <Flag meeting={meeting} /> Latest race, round {round.slice(1)}
        </p>
        <h3>{meeting.meetingName}</h3>
        <p className="latest-place">
          {meeting.location}, {meeting.countryName}
          <span>{range(meeting.dateStart, meeting.dateEnd)}</span>
        </p>
        <div className="latest-actions">
          <Button
            disabled={!race}
            onClick={() => race && onOpenSession(race)}
            className="latest-play"
          >
            <Play size={16} aria-hidden="true" /> Replay the race
          </Button>
          <Button variant="secondary" onClick={() => onOpenRound(meeting)}>
            <CalendarDays size={15} aria-hidden="true" /> All sessions
          </Button>
        </div>
      </div>
      <Podium podium={podium} pending={pending} />
    </article>
  )
}
