import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  CircleHelp,
  Gauge,
  Headphones,
  LayoutDashboard,
  Radio,
  RotateCcw,
  Unplug,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  ReplayLibrary,
  type ReplaySelection,
} from '@/features/replay/replay-library'
import { getCapabilities, type Mode } from '@/lib/api'

type View = Mode | 'overview'
const navigation: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'replay', label: 'Replay', icon: RotateCcw },
  { id: 'telemetry', label: 'Telemetry', icon: Gauge },
  { id: 'radio', label: 'Team Radio', icon: Headphones },
]
const views = new Set<View>(navigation.map(({ id }) => id))

function getHash() {
  return location.hash
}

function getView(hash: string): View {
  const value = hash.slice(1).split('?')[0] as View
  return views.has(value) ? value : 'overview'
}

function getReplaySelection(hash: string): ReplaySelection {
  const parameters = new URLSearchParams(hash.split('?')[1] ?? '')
  const currentYear = new Date().getUTCFullYear()
  const requestedYear = Number(parameters.get('year'))
  const year =
    Number.isInteger(requestedYear) &&
    requestedYear >= 2023 &&
    requestedYear <= currentYear
      ? requestedYear
      : currentYear
  const requestedMeeting = Number(parameters.get('meeting'))
  const meetingKey =
    Number.isInteger(requestedMeeting) && requestedMeeting > 0
      ? requestedMeeting
      : null
  const requestedSession = Number(parameters.get('session'))
  const sessionKey =
    meetingKey !== null &&
    Number.isInteger(requestedSession) &&
    requestedSession > 0
      ? requestedSession
      : null
  return { year, meetingKey, sessionKey }
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function App() {
  const hash = useSyncExternalStore(subscribe, getHash)
  const view = getView(hash)
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => getCapabilities(signal),
    staleTime: 60_000,
    retry: false,
  })

  return (
    <div className="pitlane-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <header className="race-header">
        <a
          className="race-brand"
          href="#overview"
          aria-label="PitLane overview"
        >
          <span className="race-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            PIT<span>LANE</span>
          </span>
        </a>
        <nav className="race-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`race-nav-link ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="race-header-status">
          <span className="archive-indicator">
            <i /> HISTORICAL DATA
          </span>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="About PitLane"
                className="about-icon"
              >
                <CircleHelp size={17} aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle className="dialog-title">
                A closer look at the race.
              </DialogTitle>
              <DialogDescription className="dialog-description">
                PitLane is an independent personal Formula 1 timing, replay,
                telemetry, and team radio project. It is not affiliated with
                Formula 1.
              </DialogDescription>
              <p className="muted">
                Historical streams appear only where the source provides them.
              </p>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main id="main" className="race-main" tabIndex={-1}>
        {view === 'replay' ? (
          <ReplayLibrary selection={getReplaySelection(hash)} />
        ) : null}
        {view === 'overview' ? <Overview /> : null}
        {view !== 'overview' && view !== 'replay' ? (
          <ModePage mode={view} />
        ) : null}
        <footer className="race-footer">
          <span>
            <b>PITLANE</b> / Independent race data workspace
          </span>
          <div className="api-status" aria-live="polite">
            {capabilities.isPending ? (
              <>
                <span className="api-dot pending" /> Checking API…
              </>
            ) : null}
            {capabilities.isError ? (
              <>
                <Unplug size={13} aria-hidden="true" /> API unavailable{' '}
                <button
                  onClick={() => void capabilities.refetch()}
                  disabled={capabilities.isFetching}
                >
                  {capabilities.isFetching ? 'Retrying…' : 'Retry'}
                </button>
              </>
            ) : null}
            {capabilities.isSuccess ? (
              <>
                <span className="api-dot" /> API connected
              </>
            ) : null}
          </div>
        </footer>
      </main>
    </div>
  )
}

function Overview() {
  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div className="overview-copy">
          <p className="section-kicker">
            <span /> THE PIT WALL, ON YOUR TERMS
          </p>
          <h1>
            Every lap has
            <br />
            another story.
          </h1>
          <p className="overview-lede">
            Choose a recorded Formula 1 session and follow the race through real
            position, timing, and car data.
          </p>
          <a className="race-primary-link" href="#replay">
            <RotateCcw size={16} aria-hidden="true" /> Open race replay{' '}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
        <div
          className="overview-signal"
          aria-label="Live session not connected"
        >
          <div className="signal-head">
            <span className="signal-light" />
            <span>LIVE FEED</span>
            <strong>OFFLINE</strong>
          </div>
          <div className="signal-rule" />
          <p>Historical replay is ready.</p>
          <span>OpenF1 archive · 2023 onward</span>
        </div>
      </section>
      <section className="mode-strip" aria-label="PitLane modes">
        <a href="#live">
          <Radio size={17} aria-hidden="true" />
          <span>
            <strong>Live</strong>
            <small>Provider not connected</small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <a href="#replay">
          <RotateCcw size={17} aria-hidden="true" />
          <span>
            <strong>Replay</strong>
            <small>Recorded sessions</small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <a href="#telemetry">
          <Activity size={17} aria-hidden="true" />
          <span>
            <strong>Telemetry</strong>
            <small>Available by session</small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
        <a href="#radio">
          <AudioLines size={17} aria-hidden="true" />
          <span>
            <strong>Team radio</strong>
            <small>Clips when available</small>
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </section>
      <p className="overview-source">
        No session loaded <span /> No timing, telemetry, or positions are shown
        until a session is selected.
      </p>
    </div>
  )
}

function ModePage({ mode }: { mode: Mode }) {
  const item = navigation.find((entry) => entry.id === mode)!
  const descriptions: Record<
    Mode,
    { title: string; description: string; availability: string }
  > = {
    live: {
      title: 'No live feed connected',
      description:
        'Live timing requires an eligible real-time data source. This workspace will show positions and race control only when that connection is configured.',
      availability: 'LIVE PROVIDER · NOT CONNECTED',
    },
    replay: {
      title: 'Choose a session',
      description:
        'Browse historical sessions, then replay recorded positions where OpenF1 has them.',
      availability: 'HISTORICAL · OPENF1',
    },
    telemetry: {
      title: 'Compare a recorded lap',
      description:
        'Speed, throttle, brake, RPM, and gear depend on the selected driver and session. Select a historical session to see what data is available.',
      availability: 'TELEMETRY · SESSION DEPENDENT',
    },
    radio: {
      title: 'No radio clips loaded',
      description:
        'Recordings are not available for every session. PitLane will list only clips returned by the source; no audio is fabricated.',
      availability: 'TEAM RADIO · COVERAGE VARIES',
    },
  }
  const content = descriptions[mode]
  return (
    <section className="mode-page" aria-labelledby="mode-title">
      <div className="mode-page-title">
        <span className="mode-page-icon">
          <item.icon size={19} aria-hidden="true" />
        </span>
        <span>{item.label}</span>
        <i>{content.availability}</i>
      </div>
      <div className="mode-empty-stage">
        <div className="mode-stage-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1 id="mode-title">{content.title}</h1>
        <p>{content.description}</p>
        <a className="race-primary-link" href="#replay">
          <RotateCcw size={15} aria-hidden="true" /> Browse historical replay{' '}
          <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}

export default App
