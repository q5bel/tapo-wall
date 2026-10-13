import { useRef } from 'react'
import { CameraTile, type TileHandle } from '@/components/CameraTile'
import {
  DEFAULT_LAYOUT,
  resizeCorner,
  rotationFromPointer,
  type CameraLayout,
  type ResizeCorner,
} from '@/lib/layout'
import type { Camera } from '@/lib/types'

interface CameraCanvasProps {
  cameras: Camera[]
  /** Free-form placement per camera id; missing ids fall back to {@link DEFAULT_LAYOUT}. */
  layouts: Record<string, CameraLayout>
  /** `view` opens cameras, `edit` selects them and enables the gestures. */
  mode: 'view' | 'edit'
  selectedId: string | null
  /** `null` clears the selection when the empty canvas is clicked. */
  onSelect: (id: string | null) => void
  onOpen: (camera: Camera) => void
  onLayoutsChange: (layouts: Record<string, CameraLayout>) => void
}

/** Everything one in-flight drag / resize / rotate needs to keep going. */
interface Gesture {
  id: string
  handle: TileHandle
  startX: number
  startY: number
  /** The layout as it was when the gesture started; deltas apply to this. */
  layout: CameraLayout
  /** Tile centre in client coordinates, used as the rotation pivot. */
  center: { x: number; y: number }
  baseAngle: number
  el: HTMLElement
  pointerId: number
  /** Native listeners, kept so {@link Gesture} can detach exactly these. */
  onMove: (event: PointerEvent) => void
  onEnd: (event: PointerEvent) => void
}

/** Canvas extent in CSS pixels; the scroll container pans over it. */
const CANVAS_W = 3000
const CANVAS_H = 3000

/**
 * Free-form canvas of camera tiles: drag to move, corners to resize, the top dot
 * to rotate.
 *
 * All geometry lives in `@/lib/layout`; this component only turns pointer events
 * into deltas and writes the resulting layouts back through `onLayoutsChange`.
 * A gesture attaches its `pointermove` / `pointerup` / `pointercancel` listeners
 * to the tile itself, which also holds pointer capture, so a fast drag that
 * leaves the tile keeps being tracked; the listeners are detached when the
 * gesture ends.
 *
 * Tiles stay put unless a gesture says otherwise: React keeps the same DOM node
 * across re-renders, so the listeners survive the layout updates they cause.
 */
export function CameraCanvas({
  cameras,
  layouts,
  mode,
  selectedId,
  onSelect,
  onOpen,
  onLayoutsChange,
}: CameraCanvasProps) {
  const gesture = useRef<Gesture | null>(null)

  /** Finish the active gesture and detach its listeners. */
  const end = () => {
    const current = gesture.current

    if (!current) {
      return
    }

    current.el.removeEventListener('pointermove', current.onMove)
    current.el.removeEventListener('pointerup', current.onEnd)
    current.el.removeEventListener('pointercancel', current.onEnd)

    try {
      current.el.releasePointerCapture(current.pointerId)
    } catch {
      // Pointer capture is best-effort: jsdom and old browsers lack it.
    }

    gesture.current = null
  }

  const begin = (event: React.PointerEvent, id: string, handle: TileHandle) => {
    if (mode !== 'edit') {
      return
    }

    const el = event.currentTarget as HTMLElement

    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // Same as above: not supported everywhere, the drag still works inside.
    }

    const layout = layouts[id] ?? DEFAULT_LAYOUT
    const rect = el.getBoundingClientRect()
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }

    /** Recompute the whole layout from the gesture start; deltas never compound. */
    const apply = (point: { clientX: number; clientY: number }) => {
      const current = gesture.current

      if (!current) {
        return
      }

      const dx = point.clientX - current.startX
      const dy = point.clientY - current.startY
      let next = current.layout

      if (current.handle === 'move') {
        next = { ...current.layout, x: current.layout.x + dx, y: current.layout.y + dy }
      } else if (current.handle.startsWith('resize-')) {
        const corner = current.handle.replace('resize-', '') as ResizeCorner
        next = resizeCorner(
          current.layout,
          corner,
          dx / current.layout.scale,
          dy / current.layout.scale,
        )
      } else if (current.handle === 'rotate') {
        const angle = rotationFromPointer(current.center, { x: point.clientX, y: point.clientY })
        next = {
          ...current.layout,
          rotation: ((current.layout.rotation + (angle - current.baseAngle)) % 360 + 360) % 360,
        }
      }

      onLayoutsChange({ ...layouts, [current.id]: next })
    }

    const onMove = (native: PointerEvent) => apply(native)
    const onEnd = () => end()

    gesture.current = {
      id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      layout,
      center,
      baseAngle: rotationFromPointer(center, { x: event.clientX, y: event.clientY }),
      el,
      pointerId: event.pointerId,
      onMove,
      onEnd,
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onEnd)
    el.addEventListener('pointercancel', onEnd)
  }

  return (
    <div
      className="relative min-h-[60vh] overflow-auto"
      data-testid="canvas"
    >
      <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
        {cameras.map((camera) => (
          <CameraTile
            key={camera.id}
            camera={camera}
            layout={layouts[camera.id] ?? DEFAULT_LAYOUT}
            mode={mode}
            selected={selectedId === camera.id}
            onSelect={(id) => onSelect(id)}
            onOpen={onOpen}
            onHandlePointerDown={(event, handle) => begin(event, camera.id, handle)}
          />
        ))}
      </div>
    </div>
  )
}
