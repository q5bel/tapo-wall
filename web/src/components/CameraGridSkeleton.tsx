import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** How many placeholder tiles are shown while the camera list loads. */
const PLACEHOLDER_TILES = 6

interface CameraGridSkeletonProps {
  tiles?: number
}

/**
 * Loading state of the wall: placeholder tiles shaped like {@link CameraTile}.
 *
 * The placeholders mirror the real card layout so the wall does not jump when
 * the data arrives. They are decorative, so only the live status line is
 * exposed to assistive technology.
 */
export function CameraGridSkeleton({ tiles = PLACEHOLDER_TILES }: CameraGridSkeletonProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status">
        Загрузка камер…
      </p>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-hidden="true"
      >
        {Array.from({ length: tiles }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <CardAction>
                <Skeleton className="h-5 w-20 rounded-4xl" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <Skeleton className="aspect-video w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
