import { StatusBadge } from '@/components/StatusBadge'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { VideoPlayer } from '@/components/VideoPlayer'
import type { Camera } from '@/lib/types'

interface CameraTileProps {
  camera: Camera
  /** Called when the tile is activated; opens the full-screen view. */
  onOpen: (camera: Camera) => void
}

/**
 * One camera on the wall: name and status in the header, live preview below.
 *
 * The whole tile is a single hit area. The action is a real (transparent)
 * button laid over the card rather than a click handler on the card itself, so
 * mouse, touch, Enter and Space all work and the card never nests inside
 * another interactive element. {@link VideoPlayer} keeps an unreachable camera
 * to a muted tile instead of breaking the wall.
 */
export function CameraTile({ camera, onOpen }: CameraTileProps) {
  return (
    <div className="relative">
      <Card>
        <CardHeader>
          <CardTitle className="truncate" title={camera.name}>
            {camera.name}
          </CardTitle>
          <CardAction>
            <StatusBadge status={camera.status} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <VideoPlayer
            src={camera.preview.hls}
            className="aspect-video w-full rounded-lg object-cover"
          />
        </CardContent>
      </Card>
      <button
        type="button"
        onClick={() => onOpen(camera)}
        aria-label={`Открыть «${camera.name}» на весь экран`}
        className="absolute inset-0 cursor-pointer rounded-xl transition-colors hover:bg-muted/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      />
    </div>
  )
}
