import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  CircleHelp,
  Flag,
  Gauge,
  Headphones,
  LayoutDashboard,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipBack,
  Timer,
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
import { Circuit } from '@/features/workspace/circuit'
import { SessionDialog } from '@/features/workspace/session-dialog'
import { getCapabilities, type Mode } from '@/lib/api'

type View = Mode | 'overview'
const modes: {
  id: Mode
  title: string
  icon: LucideIcon
  description: string
  empty: string
}[] = [
  {
    id: 'live',
    title: 'Live timing',
    icon: Radio,
    description: 'Every position. Every sector. As it happens.',
    empty:
      'A live data connection is not available yet. Session timing, flags, and positions will appear here once live integration is ready.',
  },
  {
    id: 'replay',
    title: 'Race replay',
    icon: RotateCcw,
    description: 'The whole race, on your terms.',
    empty:
      'No historical session is loaded. Session selection is coming next, followed by synchronized positions, timing, and replay controls.',
  },
  {
    id: 'telemetry',
    title: 'Telemetry',
    icon: Activity,
    description: 'Find the difference in every corner.',
    empty:
      'No driver telemetry is loaded. Speed, throttle, brake, RPM, and gear comparisons will appear when a supported session is available.',
  },
  {
    id: 'radio',
    title: 'Team radio',
    icon: Headphones,
    description: 'Hear the moments behind the race.',
    empty:
      'No radio clips are loaded. Available recordings will appear by session and driver. Not every session includes team radio.',
  },
]
const views = new Set<View>([
  'overview',
  'live',
  'replay',
  'telemetry',
  'radio',
])
function getView(): View {
  const value = location.hash.slice(1) as View
  return views.has(value) ? value : 'overview'
}
function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function App() {
  const view = useSyncExternalStore(subscribe, getView)
  const selectedMode = modes.find((mode) => mode.id === view)
  const reducedMotion = useReducedMotion()
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => getCapabilities(signal),
    staleTime: 60_000,
    retry: false,
  })

  return (
    <div className="app-shell">
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
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="PitLane overview">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            PitLane<span className="brand-period">.</span>
          </span>
        </a>
        <div className="sidebar-label">Your pit wall</div>
        <nav aria-label="Main navigation">
          <a
            href="#overview"
            className={`nav-link ${view === 'overview' ? 'active' : ''}`}
            aria-current={view === 'overview' ? 'page' : undefined}
          >
            <LayoutDashboard size={18} aria-hidden="true" />
            <span>Overview</span>
          </a>
          {modes.map(({ id, title, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={`nav-link ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{title}</span>
              {id === 'live' ? <span className="nav-dot" /> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="project-note">
            <Flag size={18} aria-hidden="true" />
            <strong>Built for the love of racing.</strong>
            <p>Your personal window into Formula 1.</p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" className="about-button">
                <CircleHelp size={17} aria-hidden="true" /> About PitLane
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle className="dialog-title">
                A closer look at the race.
              </DialogTitle>
              <DialogDescription className="dialog-description">
                PitLane is a personal Formula 1 timing, replay, telemetry, and
                team radio project. This foundation preview has no connected
                race data. It is unofficial and is not affiliated with Formula
                1.
              </DialogDescription>
              <p className="muted">
                Start with Race replay to see what is being built next.
              </p>
            </DialogContent>
          </Dialog>
          <span className="version">
            Foundation preview <span>v0.1</span>
          </span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} aria-hidden="true" />
            <span>{selectedMode?.title ?? 'Overview'}</span>
          </div>
          <div className="topbar-right">
            <span className="session-status">
              <span /> No session connected
            </span>
            <span className="personal-badge">Personal workspace</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">Your race. Your perspective.</div>
              <h1>{selectedMode?.title ?? 'Welcome to the pit wall.'}</h1>
              <p>
                {selectedMode?.description ??
                  'Follow the action. Rewind the details. Understand the race.'}
              </p>
            </div>
            <SessionDialog compact />
          </div>

          {selectedMode ? (
            <section className="mode-empty panel" aria-labelledby="mode-title">
              <selectedMode.icon
                size={35}
                className="empty-icon"
                aria-hidden="true"
              />
              <span className="status-tag">Not connected</span>
              <h2 id="mode-title">
                {view === 'live'
                  ? 'Waiting for a live connection.'
                  : view === 'replay'
                    ? 'The next race is yours to replay.'
                    : view === 'telemetry'
                      ? 'Every detail starts with a session.'
                      : 'The airwaves are quiet.'}
              </h2>
              <p>{selectedMode.empty}</p>
              {view === 'replay' ? (
                <SessionDialog />
              ) : (
                <Button asChild variant="secondary">
                  <a href="#replay">
                    Go to race replay{' '}
                    <ChevronRight size={15} aria-hidden="true" />
                  </a>
                </Button>
              )}
              <div className="mode-features">
                {view === 'telemetry'
                  ? 'Speed / Throttle / Brake / RPM / Gear'
                  : view === 'radio'
                    ? 'Available clips / Driver filters / Timeline jumps'
                    : view === 'live'
                      ? 'Timing / Sectors / Stints / Race control'
                      : 'Positions / Playback / Timing / Race events'}
              </div>
            </section>
          ) : null}

          {!selectedMode ? (
            <>
              <div className="workspace-grid">
                <motion.section
                  className="circuit-panel panel"
                  aria-labelledby="circuit-heading"
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="panel-heading">
                    <div className="panel-title">
                      <span className="red-rule" />
                      <h2 id="circuit-heading">Race centre</h2>
                    </div>
                    <span className="status-tag">No session loaded</span>
                  </div>
                  <div className="circuit-intro">
                    <span className="workspace-caption">
                      A different view of race day
                    </span>
                    <h3>See the race unfold.</h3>
                    <p>One circuit. Every moment that matters.</p>
                  </div>
                  <Circuit />
                  <div className="circuit-callout">
                    <div>
                      <span className="empty-indicator" />
                      <span>Load a session to bring the circuit to life.</span>
                    </div>
                    <SessionDialog />
                  </div>
                  <div className="playback-bar">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled
                      aria-label="Return to session start"
                    >
                      <SkipBack size={15} aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      disabled
                      aria-label="Play replay"
                    >
                      <Play size={15} aria-hidden="true" />
                    </Button>
                    <span className="time-placeholder">—:—</span>
                    <div className="timeline-placeholder" />
                    <span className="playback-speed">1×</span>
                    <span className="playback-label">Replay</span>
                  </div>
                </motion.section>

                <section
                  className="timing-panel panel"
                  aria-labelledby="timing-heading"
                >
                  <div className="panel-heading">
                    <div className="panel-title">
                      <Timer size={17} aria-hidden="true" />
                      <h2 id="timing-heading">Timing tower</h2>
                    </div>
                    <span className="quiet-label">Session —</span>
                  </div>
                  <div className="timing-columns">
                    <span>Pos / Driver</span>
                    <span>Interval</span>
                    <span>Tyre</span>
                  </div>
                  <div className="timing-empty">
                    <div className="empty-symbol">
                      <Gauge size={27} aria-hidden="true" />
                    </div>
                    <h3>Waiting for the grid</h3>
                    <p>
                      Driver positions and lap times will appear when a session
                      is loaded.
                    </p>
                    <a className="text-link" href="#replay">
                      Explore race replay{' '}
                      <ChevronRight size={14} aria-hidden="true" />
                    </a>
                  </div>
                  <div className="timing-footer">
                    <span className="empty-indicator" /> No timing data
                  </div>
                </section>
              </div>
              <section
                className="explore-section"
                aria-labelledby="explore-heading"
              >
                <div className="section-heading">
                  <h2 id="explore-heading">Closer to every moment.</h2>
                  <span>Four ways into the race</span>
                </div>
                <div className="mode-grid">
                  {modes.map(({ id, title, description, icon: Icon }) => (
                    <a href={`#${id}`} className="mode-card" key={id}>
                      <div className="mode-card-top">
                        <span className="mode-card-icon">
                          <Icon size={21} aria-hidden="true" />
                        </span>
                        <ArrowUpRight size={17} aria-hidden="true" />
                      </div>
                      <h3>{title}</h3>
                      <p>{description}</p>
                      <span className="card-availability">
                        {id === 'replay' ? 'Up next' : 'Planned'}
                        <ChevronRight size={12} aria-hidden="true" />
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <div className="bottom-grid">
            <section
              className="panel session-events"
              aria-labelledby="events-heading"
            >
              <div className="panel-heading">
                <div className="panel-title">
                  <Flag size={16} aria-hidden="true" />
                  <h2 id="events-heading">Session events</h2>
                </div>
                <span className="quiet-label">Race control & key moments</span>
              </div>
              <div className="inline-empty">
                <Pause size={20} aria-hidden="true" />
                <div>
                  <h3>No events to show</h3>
                  <p>
                    Flags, pit stops, and race moments will follow the session
                    timeline.
                  </p>
                </div>
              </div>
            </section>
            <section
              className="panel radio-preview"
              aria-labelledby="radio-heading"
            >
              <div className="panel-heading">
                <div className="panel-title">
                  <AudioLines size={18} aria-hidden="true" />
                  <h2 id="radio-heading">On the radio</h2>
                </div>
                <a
                  href="#radio"
                  aria-label="Open team radio"
                  className="icon-link"
                >
                  <ArrowUpRight size={17} aria-hidden="true" />
                </a>
              </div>
              <div className="inline-empty">
                <Headphones size={23} aria-hidden="true" />
                <div>
                  <h3>No recordings loaded</h3>
                  <p>Available clips will appear here.</p>
                </div>
              </div>
            </section>
          </div>

          <footer className="page-footer">
            <span>
              PitLane <span className="footer-divider">/</span> A closer look at
              Formula 1.
            </span>
            <div className="api-status" aria-live="polite">
              {capabilities.isPending ? (
                <>
                  <ArrowDownToLine size={12} aria-hidden="true" /> Checking API…
                </>
              ) : capabilities.isError ? (
                <>
                  <Unplug size={12} aria-hidden="true" /> API unavailable{' '}
                  <button
                    onClick={() => void capabilities.refetch()}
                    disabled={capabilities.isFetching}
                  >
                    {capabilities.isFetching ? 'Retrying…' : 'Retry'}
                  </button>
                </>
              ) : (
                <>
                  <span className="api-dot" /> API connected · Race data not
                  integrated
                </>
              )}
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}

export default App
