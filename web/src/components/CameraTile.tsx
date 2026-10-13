import { StatusBadge } from '@/components/StatusBadge'
import { VideoPlayer } from '@/components/VideoPlayer'
import type { CameraLayout } from '@/lib/layout'
import type { Camera } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Every gesture a tile can start; the canvas owns what each one means. */
export type TileHandle = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'rotate'

interface CameraTileProps {
  camera: Camera
  /** Free-form placement of the tile on the canvas. */
  layout: CameraLayout
  /** `view` opens on click, `edit` selects and exposes the gesture handles. */
  mode: 'view' | 'edit'
  selected?: boolean
  onSelect?: (id: string) => void
  onOpen: (camera: Camera) => void
  /**
   * Gesture entry point. The tile only reports where a gesture started; the
   * canvas listens for the following moves and writes the new layout back.
   */
  onHandlePointerDown?: (event: React.PointerEvent, handle: TileHandle) => void
}

/**
 * One camera on the free-form canvas.
 *
 * The tile is absolutely positioned and transformed from its {@link CameraLayout},
 * so dragging, resizing and rotating it is a pure math problem owned by
 * {@link CameraCanvas}; this component only renders the result and reports where a
 * gesture began.
 *
 * In `view` mode the whole tile is one real (transparent) button, so mouse,
 * touch, Enter and Space all open the camera. In `edit` mode the body starts the
 * move gesture and selecting happens on click; corner dots and the top dot start
 * resize and rotate. {@link VideoPlayer} keeps an unreachable camera to a muted
 * tile instead of breaking the wall.
 */
export function CameraTile({
  camera,
  layout,
  mode,
  selected = false,
  onSelect,
  onOpen,
  onHandlePointerDown,
}: CameraTileProps) {
  const startGesture = (event: React.PointerEvent, handle: TileHandle) => {
    // A handle sits inside the tile body: without this the body's own
    // pointerdown would bubble up and overwrite the gesture with `move`.
    event.stopPropagation()
    onHandlePointerDown?.(event, handle)
  }

  return (
    <div
      data-testid={`tile-${camera.id}`}
      data-handle={mode === 'edit' ? 'move' : undefined}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: layout.w,
        height: layout.h,
        transform: `translate(${layout.x}px, ${layout.y}px) rotate(${layout.rotation}deg) scale(${layout.scale})`,
        transformOrigin: '0 0',
      }}
      className={cn('group', mode === 'edit' && selected && 'ring-2 ring-ring')}
      onDoubleClick={() => onOpen(camera)}
      onClick={() => {
        if (mode === 'edit') {
          onSelect?.(camera.id)
        }
      }}
      onPointerDown={mode === 'edit' ? (event) => onHandlePointerDown?.(event, 'move') : undefined}
    >
      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="truncate text-sm font-medium">{camera.name}</span>
          <StatusBadge status={camera.status} />
        </div>
        <div className="min-h-0 flex-1">
          <VideoPlayer src={camera.preview.hls} className="h-full w-full object-cover" />
        </div>
      </div>
      {mode === 'view' && (
        <button
          type="button"
          aria-label={`Открыть «${camera.name}»`}
          className="absolute inset-0 cursor-pointer"
          onClick={() => onOpen(camera)}
        />
      )}
      {mode === 'edit' && selected && (
        <>
          <button
            type="button"
            data-testid="resize-nw"
            data-handle="resize-nw"
            aria-label={`Изменить размер «${camera.name}» (верхний левый угол)`}
            className="absolute -left-1.5 -top-1.5 size-3 cursor-nwse-resize rounded-full bg-ring"
            onPointerDown={(event) => startGesture(event, 'resize-nw')}
          />
          <button
            type="button"
            data-testid="resize-ne"
            data-handle="resize-ne"
            aria-label={`Изменить размер «${camera.name}» (верхний правый угол)`}
            className="absolute -right-1.5 -top-1.5 size-3 cursor-nesw-resize rounded-full bg-ring"
            onPointerDown={(event) => startGesture(event, 'resize-ne')}
          />
          <button
            type="button"
            data-testid="resize-sw"
            data-handle="resize-sw"
            aria-label={`Изменить размер «${camera.name}» (нижний левый угол)`}
            className="absolute -left-1.5 -bottom-1.5 size-3 cursor-nesw-resize rounded-full bg-ring"
            onPointerDown={(event) => startGesture(event, 'resize-sw')}
          />
          <button
            type="button"
            data-testid="resize-se"
            data-handle="resize-se"
            aria-label={`Изменить размер «${camera.name}» (нижний правый угол)`}
            className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full bg-ring"
            onPointerDown={(event) => startGesture(event, 'resize-se')}
          />
          <button
            type="button"
            data-testid="rotate"
            data-handle="rotate"
            aria-label={`Повернуть «${camera.name}»`}
            className="absolute -top-6 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full bg-ring"
            onPointerDown={(event) => startGesture(event, 'rotate')}
          />
        </>
      )}
    </div>
  )
}
