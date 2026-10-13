import { useMemo } from 'react'
import { CameraTile } from '@/components/CameraTile'
import { DEFAULT_LAYOUT, autoArrange } from '@/lib/layout'
import type { Camera } from '@/lib/types'

interface CameraGridProps {
  cameras: Camera[]
  /** Called with the camera whose tile was activated. */
  onSelect: (camera: Camera) => void
}

/** Vertical room the wall reserves for the arranged tiles, in CSS pixels. */
const WALL_HEIGHT = 600

/**
 * Read-only wall of camera tiles.
 *
 * Thin wrapper over {@link CameraTile}: the tiles are laid out once with
 * {@link autoArrange} and rendered in `view` mode, where a click opens the
 * camera. The interactive free-form canvas is {@link CameraCanvas}; this stays
 * as the simple, non-editable overview.
 */
export function CameraGrid({ cameras, onSelect }: CameraGridProps) {
  const layouts = useMemo(() => autoArrange(cameras.map((camera) => camera.id)), [cameras])

  return (
    <div className="relative" style={{ height: WALL_HEIGHT }}>
      {cameras.map((camera) => (
        <CameraTile
          key={camera.id}
          camera={camera}
          layout={layouts[camera.id] ?? DEFAULT_LAYOUT}
          mode="view"
          onOpen={onSelect}
        />
      ))}
    </div>
  )
}
