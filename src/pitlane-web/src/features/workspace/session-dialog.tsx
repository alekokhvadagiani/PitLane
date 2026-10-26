import { CalendarDays, ExternalLink, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function SessionDialog({ compact = false }: { compact?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant={compact ? 'secondary' : 'default'}
          size={compact ? 'small' : 'default'}
        >
          <CalendarDays size={16} aria-hidden="true" />{' '}
          {compact ? 'Session library' : 'Explore replay'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div className="dialog-symbol">
          <Flag size={26} aria-hidden="true" />
        </div>
        <DialogTitle className="dialog-title">
          Your race library starts here.
        </DialogTitle>
        <DialogDescription className="dialog-description">
          Historical session selection is coming next. No races are loaded yet,
          so replay, timing, and radio are unavailable.
        </DialogDescription>
        <div className="notice">
          Historical data availability varies by session. A session will only
          appear as replayable once its position and timing data are verified.
        </div>
        <Button asChild variant="secondary">
          <a href="https://openf1.org/docs/" target="_blank" rel="noreferrer">
            Read about the data <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  )
}
