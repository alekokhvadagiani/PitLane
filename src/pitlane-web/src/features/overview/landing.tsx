import type { CSSProperties } from 'react'
import { Activity, AudioLines, CalendarDays, Play, Radio } from 'lucide-react'
import { circuitOutline } from '@/features/replay/countries'
import { Flag, RoundCard } from '@/features/replay/season-home'
import {
  formatDays,
  replayHash,
  seasonState,
  teamHex,
  useRacePodium,
  useSeasonMeetings,
  type PodiumPlace,
} from '@/features/replay/season'
import { accentStyle } from '@/lib/accent'
import { about } from '@/content/about'
import { LightsOut } from '@/features/overview/lights-out'
import type { Meeting } from '@/lib/api'

const thisYear = new Date().getUTCFullYear()

function surname(place: PodiumPlace) {
  const name = place.driver?.fullName
  if (!name) return `car ${place.driverNumber}`
  return name
    .split(' ')
    .map((part) =>
      part === part.toUpperCase()
        ? part[0] + part.slice(1).toLowerCase()
        : part,
    )
    .join(' ')
}

/** One sentence built only from the recorded classification. */
function raceSummary(podium: PodiumPlace[]) {
  const [first, second, third] = podium
  if (!first) return null
  const team = first.driver?.teamName ? ` for ${first.driver.teamName}` : ''
  if (!second || !third) return `${surname(first)} won${team}.`
  return `${surname(first)} won${team}, ahead of ${surname(second)} and ${surname(third)}.`
}

const modes = [
  {
    href: '#replay',
    icon: Play,
    title: 'Race replay',
    text: 'Every car on the circuit with timing, gaps, tyres and pit stops.',
    colour: 'var(--accent)',
  },
  {
    href: '#telemetry',
    icon: Activity,
    title: 'Telemetry',
    text: 'Speed, throttle, brake and gear for the car you follow.',
    colour: '#2fd16f',
  },
  {
    href: '#radio',
    icon: AudioLines,
    title: 'Team radio',
    text: 'The clips OpenF1 recorded, played at the moment they aired.',
    colour: '#b07cff',
  },
  {
    href: '#live',
    icon: Radio,
    title: 'Live timing',
    text: 'Not connected yet. Replays use recorded sessions only.',
    colour: '#ff5a4f',
  },
]

/**
 * Landing page: the most recent Grand Prix in its winner's colours, the
 * latest rounds and what PitLane can show. Falls back to the previous season
 * before the first race of the year.
 */
export function Landing() {
  const current = useSeasonMeetings(thisYear)
  const currentState = seasonState(current.data?.items ?? [])
  const usePrevious = current.isSuccess && !currentState.latest
  const previous = useSeasonMeetings(thisYear - 1, usePrevious)
  const year = usePrevious ? thisYear - 1 : thisYear
  const state = usePrevious
    ? seasonState(previous.data?.items ?? [])
    : currentState
  const latest = state.latest
  const { race, podium } = useRacePodium(latest?.meeting)
  const winnerColour = podium[0]?.driver?.teamColour
  const recent = state.finished.slice(-4)
  const upcoming = thisYear === year ? state.next : undefined
  const openRound = (meeting: Meeting) => {
    location.hash = replayHash(year, meeting.meetingKey)
  }

  return (
    <div className="landing">
      <section
        className="landing-hero"
        style={
          {
            '--winner': teamHex(podium[0]?.driver),
            ...accentStyle(winnerColour),
          } as CSSProperties
        }
      >
        <div className="landing-copy">
          {latest ? (
            <>
              <p className="landing-meta">
                <Flag meeting={latest.meeting} />
                Round {latest.round.slice(1)}, {latest.meeting.location},{' '}
                {formatDays(latest.meeting.dateStart, latest.meeting.dateEnd)}
              </p>
              <h1>Relive the {latest.meeting.meetingName}.</h1>
              <p className="landing-lede">
                {raceSummary(podium) ??
                  'Follow every car around the circuit, lap by lap.'}
              </p>
            </>
          ) : (
            <>
              <h1>Replay any Formula 1 session since 2023.</h1>
              <p className="landing-lede">
                Car positions, timing, telemetry and team radio, from the
                sessions OpenF1 recorded.
              </p>
            </>
          )}
          <div className="landing-actions">
            {latest && race ? (
              <a
                className="race-primary-link"
                href={replayHash(
                  year,
                  latest.meeting.meetingKey,
                  race.sessionKey,
                )}
              >
                <Play size={17} aria-hidden="true" /> Replay the race
              </a>
            ) : null}
            <a
              className={latest && race ? 'landing-link' : 'race-primary-link'}
              href={replayHash(year)}
            >
              <CalendarDays size={16} aria-hidden="true" /> Browse every session
            </a>
          </div>
          {podium.length ? (
            <ol className="landing-podium" aria-label="Podium">
              {podium.map((place) => (
                <li
                  key={place.driverNumber}
                  style={{ '--team': teamHex(place.driver) } as CSSProperties}
                >
                  {place.driver?.headshotUrl ? (
                    <img src={place.driver.headshotUrl} alt="" />
                  ) : (
                    <span className="podium-face" />
                  )}
                  <span>
                    <b>P{place.position}</b>
                    {place.driver?.nameAcronym ?? `#${place.driverNumber}`}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <LandingCircuit name={latest?.meeting.circuitShortName} />
      </section>

      {recent.length ? (
        <section className="landing-rounds" aria-labelledby="landing-rounds">
          <header>
            <h2 id="landing-rounds">The {year} season so far</h2>
            <a href={replayHash(year)}>
              Full calendar, {state.finished.length} of{' '}
              {state.grandsPrix.length} rounds run
            </a>
          </header>
          <ol>
            {[...recent].reverse().map((entry) => (
              <li key={entry.meeting.meetingKey}>
                <RoundCard
                  entry={entry}
                  latest={entry === latest}
                  onOpen={openRound}
                />
              </li>
            ))}
            {upcoming ? (
              <li>
                <RoundCard entry={upcoming} onOpen={openRound} />
              </li>
            ) : null}
          </ol>
        </section>
      ) : null}

      <LightsOut
        circuit={latest?.meeting.circuitShortName}
        colour={teamHex(podium[0]?.driver)}
        replayHref={
          latest && race
            ? replayHash(year, latest.meeting.meetingKey, race.sessionKey)
            : undefined
        }
      />

      <section className="landing-modes" aria-label="What you can follow">
        {modes.map(({ href, icon: Icon, title, text, colour }) => (
          <a
            key={href}
            href={href}
            style={{ '--mode': colour } as CSSProperties}
          >
            <Icon size={22} aria-hidden="true" />
            <strong>{title}</strong>
            <span>{text}</span>
          </a>
        ))}
      </section>

      <section className="landing-about" aria-labelledby="landing-about">
        <span className="about-mark" aria-hidden="true">
          {about.initials}
        </span>
        <div>
          <p className="about-role">{about.role}</p>
          <h2 id="landing-about">Hi, I’m {about.name}.</h2>
          {about.story.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <ul>
            {about.links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

/** The latest race's recorded circuit, drawn once when the page opens. */
function LandingCircuit({ name }: { name?: string }) {
  const path = name ? circuitOutline(name) : undefined
  return (
    <div className="landing-circuit" aria-hidden="true">
      {path ? (
        <svg viewBox="-8 -8 116 116">
          <path className="landing-tarmac" d={path} />
          <path className="landing-line" d={path} pathLength={1} />
        </svg>
      ) : null}
    </div>
  )
}
