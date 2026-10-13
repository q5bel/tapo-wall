/**
 * Pure geometry helpers for the free-form camera canvas (drag / resize / rotate / scale).
 *
 * No DOM, no React: every function takes plain numbers and returns new values.
 */

export interface CameraLayout {
  x: number
  y: number
  w: number
  h: number
  rotation: number
  scale: number
}

export const DEFAULT_LAYOUT: CameraLayout = { x: 0, y: 0, w: 320, h: 180, rotation: 0, scale: 1 }

export const MIN_W = 160
export const MIN_H = 90
export const MIN_SCALE = 0.25
export const MAX_SCALE = 4

export interface AutoArrangeOptions {
  columns?: number
  gap?: number
  tileW?: number
  tileH?: number
  originX?: number
  originY?: number
}

/** Wrap any angle into `[0, 360)`. */
function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Fill missing fields from DEFAULT_LAYOUT and clamp the constrained ones.
 * `x` / `y` are intentionally left unbounded so tiles can sit anywhere on the canvas.
 */
export function normalizeLayout(partial: Partial<CameraLayout>): CameraLayout {
  return {
    x: partial.x ?? DEFAULT_LAYOUT.x,
    y: partial.y ?? DEFAULT_LAYOUT.y,
    w: Math.max(MIN_W, partial.w ?? DEFAULT_LAYOUT.w),
    h: Math.max(MIN_H, partial.h ?? DEFAULT_LAYOUT.h),
    rotation: normalizeRotation(partial.rotation ?? DEFAULT_LAYOUT.rotation),
    scale: clamp(partial.scale ?? DEFAULT_LAYOUT.scale, MIN_SCALE, MAX_SCALE),
  }
}

/** Lay ids out on a `columns`-wide grid of `tileW` x `tileH` tiles. */
export function autoArrange(ids: string[], opts: AutoArrangeOptions = {}): Record<string, CameraLayout> {
  const columns = opts.columns ?? 3
  const gap = opts.gap ?? 16
  const tileW = opts.tileW ?? DEFAULT_LAYOUT.w
  const tileH = opts.tileH ?? DEFAULT_LAYOUT.h
  const originX = opts.originX ?? 0
  const originY = opts.originY ?? 0

  const result: Record<string, CameraLayout> = {}

  ids.forEach((id, i) => {
    const col = i % columns
    const row = Math.floor(i / columns)
    result[id] = {
      x: originX + col * (tileW + gap),
      y: originY + row * (tileH + gap),
      w: tileW,
      h: tileH,
      rotation: 0,
      scale: 1,
    }
  })

  return result
}

/**
 * Convert a pointer delta in screen space into the tile's local, unrotated frame
 * by rotating it back by `rotationDeg`.
 */
export function screenDeltaToLocal(dx: number, dy: number, rotationDeg: number): { x: number; y: number } {
  const rad = (-rotationDeg * Math.PI) / 180
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

/**
 * Resize a tile by dragging one of its corners. The pointer delta is de-rotated
 * first, then applied to the edges owned by that corner. The result is
 * normalized, so MIN_W / MIN_H hold even when the drag overshoots.
 */
export function resizeCorner(
  layout: CameraLayout,
  corner: ResizeCorner,
  dx: number,
  dy: number,
): CameraLayout {
  const local = screenDeltaToLocal(dx, dy, layout.rotation)

  const next: CameraLayout = { ...layout }

  switch (corner) {
    case 'nw':
      next.x += local.x
      next.y += local.y
      next.w -= local.x
      next.h -= local.y
      break
    case 'ne':
      next.y += local.y
      next.w += local.x
      next.h -= local.y
      break
    case 'sw':
      next.x += local.x
      next.w -= local.x
      next.h += local.y
      break
    case 'se':
      next.w += local.x
      next.h += local.y
      break
  }

  return normalizeLayout(next)
}

/** Angle in degrees (normalized to `[0, 360)`) from a center point to a pointer. */
export function rotationFromPointer(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
): number {
  const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI
  return normalizeRotation(deg)
}
