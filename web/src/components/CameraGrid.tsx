import { CameraTile } from '@/components/CameraTile'
import type { Camera } from '@/lib/types'

interface CameraGridProps {
  cameras: Camera[]
  /** Called with the camera whose tile was activated. */
  onSelect: (camera: Camera) => void
}

/**
 * Responsive wall of camera tiles.
 *
 * One column on phones, two on tablets, three on wide screens. Each tile owns
 * its own HLS player, so a camera going down only blanks that one tile.
 */
export function CameraGrid({ cameras, onSelect }: CameraGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cameras.map((camera) => (
        <CameraTile key={camera.id} camera={camera} onOpen={onSelect} />
      ))}
    </div>
  )
}
