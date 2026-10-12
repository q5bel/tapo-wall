import { Badge, badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CameraStatus } from '@/lib/types'
import type { VariantProps } from 'class-variance-authority'

/** Any variant the Badge component accepts. */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

interface StatusPresentation {
  variant: BadgeVariant
  label: string
  /** Classes of the status dot drawn inside the badge. */
  dot: string
}

/**
 * How each camera status looks and reads.
 *
 * Only semantic tokens are used, so the same table works in both themes; the
 * `connecting` dot pulses because that state is transient by nature.
 */
const STATUS_PRESENTATION: Record<CameraStatus, StatusPresentation> = {
  online: {
    variant: 'default',
    label: 'онлайн',
    dot: 'bg-primary-foreground',
  },
  offline: {
    variant: 'destructive',
    label: 'офлайн',
    dot: 'bg-destructive',
  },
  connecting: {
    variant: 'secondary',
    label: 'подключение',
    dot: 'bg-muted-foreground animate-pulse',
  },
}

/** Shown when the API reports a status this build does not know about. */
const UNKNOWN_STATUS: StatusPresentation = {
  variant: 'outline',
  label: 'неизвестно',
  dot: 'bg-muted-foreground',
}

export interface StatusBadgeProps {
  status: CameraStatus
  className?: string
}

/**
 * Status pill for one camera.
 *
 * Shared by the wall tile and the full-screen dialog so a camera never reads
 * differently depending on where it is shown.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const presentation = STATUS_PRESENTATION[status] ?? UNKNOWN_STATUS

  return (
    <Badge variant={presentation.variant} className={className}>
      <span
        className={cn('size-1.5 rounded-full', presentation.dot)}
        aria-hidden="true"
      />
      {presentation.label}
    </Badge>
  )
}
