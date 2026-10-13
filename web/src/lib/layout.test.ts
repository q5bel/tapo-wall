import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  MAX_SCALE,
  MIN_H,
  MIN_SCALE,
  MIN_W,
  autoArrange,
  normalizeLayout,
  resizeCorner,
  rotationFromPointer,
  screenDeltaToLocal,
  type CameraLayout,
} from './layout'

describe('constants', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_LAYOUT).toEqual({ x: 0, y: 0, w: 320, h: 180, rotation: 0, scale: 1 })
    expect(MIN_W).toBe(160)
    expect(MIN_H).toBe(90)
    expect(MIN_SCALE).toBe(0.25)
    expect(MAX_SCALE).toBe(4)
  })
})

describe('normalizeLayout', () => {
  it('fills every field from DEFAULT_LAYOUT when given an empty object', () => {
    expect(normalizeLayout({})).toEqual(DEFAULT_LAYOUT)
  })

  it('does not mutate the input', () => {
    const input: Partial<CameraLayout> = { rotation: 400, scale: 10 }
    normalizeLayout(input)
    expect(input).toEqual({ rotation: 400, scale: 10 })
  })

  it('wraps rotation 400 into 40', () => {
    expect(normalizeLayout({ rotation: 400 }).rotation).toBe(40)
  })

  it('wraps rotation -30 into 330', () => {
    expect(normalizeLayout({ rotation: -30 }).rotation).toBe(330)
  })

  it('clamps scale 10 down to MAX_SCALE', () => {
    expect(normalizeLayout({ scale: 10 }).scale).toBe(MAX_SCALE)
  })

  it('clamps scale 0.01 up to MIN_SCALE', () => {
    expect(normalizeLayout({ scale: 0.01 }).scale).toBe(MIN_SCALE)
  })

  it('raises w 100 to MIN_W', () => {
    expect(normalizeLayout({ w: 100 }).w).toBe(MIN_W)
  })

  it('raises h 50 to MIN_H', () => {
    expect(normalizeLayout({ h: 50 }).h).toBe(MIN_H)
  })

  it('leaves x and y untouched', () => {
    const result = normalizeLayout({ x: -500, y: 1234.5 })
    expect(result.x).toBe(-500)
    expect(result.y).toBe(1234.5)
  })

  it('keeps in-range values as-is', () => {
    const result = normalizeLayout({ x: 5, y: 6, w: 400, h: 300, rotation: 45, scale: 2 })
    expect(result).toEqual({ x: 5, y: 6, w: 400, h: 300, rotation: 45, scale: 2 })
  })
})

describe('autoArrange', () => {
  it('lays 3 ids in a single row when columns=3', () => {
    const result = autoArrange(['a', 'b', 'c'], { columns: 3 })

    expect(Object.keys(result)).toEqual(['a', 'b', 'c'])
    const [a, b, c] = [result.a, result.b, result.c]
    expect(a.y).toBe(0)
    expect(b.y).toBe(0)
    expect(c.y).toBe(0)
    expect(b.x - a.x).toBe(DEFAULT_LAYOUT.w + 16)
    expect(c.x - b.x).toBe(DEFAULT_LAYOUT.w + 16)
  })

  it('wraps 4 ids into two rows when columns=2', () => {
    const result = autoArrange(['a', 'b', 'c', 'd'], { columns: 2 })

    expect(result.a.y).toBe(0)
    expect(result.b.y).toBe(0)
    expect(result.c.y).toBe(DEFAULT_LAYOUT.h + 16)
    expect(result.d.y).toBe(DEFAULT_LAYOUT.h + 16)
    expect(result.a.x).toBe(0)
    expect(result.c.x).toBe(0)
  })

  it('shifts every tile by originX and originY', () => {
    const result = autoArrange(['a', 'b'], { columns: 1, originX: 100, originY: 50 })

    expect(result.a.x).toBe(100)
    expect(result.a.y).toBe(50)
    expect(result.b.x).toBe(100)
    expect(result.b.y).toBe(50 + DEFAULT_LAYOUT.h + 16)
  })

  it('honours gap, tileW and tileH', () => {
    const result = autoArrange(['a', 'b'], { columns: 2, gap: 8, tileW: 200, tileH: 100 })

    expect(result.a).toEqual({ x: 0, y: 0, w: 200, h: 100, rotation: 0, scale: 1 })
    expect(result.b).toEqual({ x: 208, y: 0, w: 200, h: 100, rotation: 0, scale: 1 })
  })

  it('returns an empty record for no ids', () => {
    expect(autoArrange([])).toEqual({})
  })
})

describe('screenDeltaToLocal', () => {
  it('leaves the delta unchanged at 0 degrees', () => {
    expect(screenDeltaToLocal(10, 5, 0)).toEqual({ x: 10, y: 5 })
  })

  it('turns screen X movement into local Y movement at 90 degrees', () => {
    const result = screenDeltaToLocal(10, 0, 90)
    expect(result.x).toBeCloseTo(0, 10)
    expect(result.y).toBeCloseTo(-10, 10)
  })

  it('flips the sign of both components at 180 degrees', () => {
    const result = screenDeltaToLocal(10, 5, 180)
    expect(result.x).toBeCloseTo(-10, 10)
    expect(result.y).toBeCloseTo(-5, 10)
  })
})

describe('resizeCorner', () => {
  const base: CameraLayout = { x: 0, y: 0, w: 320, h: 180, rotation: 0, scale: 1 }

  it('grows w and h without moving x/y when dragging se', () => {
    const result = resizeCorner(base, 'se', 20, 10)

    expect(result).toEqual({ ...base, w: 340, h: 190 })
  })

  it('moves x/y and shrinks w/h when dragging nw', () => {
    const result = resizeCorner(base, 'nw', 20, 10)

    expect(result).toEqual({ x: 20, y: 10, w: 300, h: 170, rotation: 0, scale: 1 })
  })

  it('clamps w to MIN_W and h to MIN_H when shrinking too far', () => {
    const result = resizeCorner(base, 'nw', 10000, 10000)

    expect(result.w).toBe(MIN_W)
    expect(result.h).toBe(MIN_H)
  })

  it('does not mutate the input layout', () => {
    const input: CameraLayout = { ...base }
    resizeCorner(input, 'se', 20, 10)
    expect(input).toEqual(base)
  })

  it('resizes along the rotated local axes', () => {
    const rotated: CameraLayout = { ...base, rotation: 90 }
    const result = resizeCorner(rotated, 'se', 10, 0)

    expect(result.w).toBeCloseTo(base.w, 10)
    expect(result.h).toBeCloseTo(base.h - 10, 10)
  })
})

describe('rotationFromPointer', () => {
  const center = { x: 0, y: 0 }

  it('reads 0 degrees for a pointer to the right', () => {
    expect(rotationFromPointer(center, { x: 1, y: 0 })).toBe(0)
  })

  it('reads 90 degrees for a pointer below (screen Y grows down)', () => {
    expect(rotationFromPointer(center, { x: 0, y: 1 })).toBe(90)
  })

  it('reads 180 degrees for a pointer to the left', () => {
    expect(rotationFromPointer(center, { x: -1, y: 0 })).toBe(180)
  })

  it('reads 270 degrees for a pointer above', () => {
    expect(rotationFromPointer(center, { x: 0, y: -1 })).toBe(270)
  })

  it('is offset by the supplied center', () => {
    expect(rotationFromPointer({ x: 10, y: 10 }, { x: 10, y: 20 })).toBe(90)
  })
})
