import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SessionDialog({ compact = false }: { compact?: boolean }) {
  return (
    <Button
      asChild
      variant={compact ? 'secondary' : 'default'}
      size={compact ? 'small' : 'default'}
    >
      <a href="#replay">
        <CalendarDays size={16} aria-hidden="true" />
        {compact ? 'Session library' : 'Browse sessions'}
      </a>
    </Button>
  )
}
