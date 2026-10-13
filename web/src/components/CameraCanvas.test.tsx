import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CameraCanvas } from '@/components/CameraCanvas'
import { DEFAULT_LAYOUT, type CameraLayout } from '@/lib/layout'
import type { Camera } from '@/lib/types'

// `test.globals` is false, so Testing Library cannot register its own
// auto-cleanup: every test must unmount what it rendered.
afterEach(cleanup)

/** jsdom has no media pipeline: `play()` is not implemented and would throw. */
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

  // jsdom gives every element a zero-sized rect, which would make the rotate
  // centre and the drag origin useless. Pin a 320x180 tile at the origin.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 320,
      height: 180,
      right: 320,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON() {
        return {}
      },
    }) as DOMRect

  // Pointer capture is not implemented in jsdom; the canvas calls it
  // defensively, so a no-op stub is enough for the gesture tests.
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

function makeCamera(id: string, name: string): Camera {
  return {
    id,
    name,
    status: 'online',
    preview: { hls: `/api/cameras/${id}/preview.m3u8`, webrtc: `/api/cameras/${id}/whep` },
    hd: { hls: `/api/cameras/${id}/hd.m3u8`, webrtc: `/api/cameras/${id}/hd/whep` },
  }
}

const cameras = [makeCamera('c1', 'Вход'), makeCamera('c2', 'Двор')]

const startLayout = (): Record<string, CameraLayout> => ({
  c1: { ...DEFAULT_LAYOUT },
  c2: { x: 400, y: 0, w: 320, h: 180, rotation: 0, scale: 1 },
})

describe('CameraCanvas', () => {
  it('renders one tile per camera', () => {
    render(
      <CameraCanvas
        cameras={cameras}
        layouts={startLayout()}
        mode="edit"
        selectedId={null}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onLayoutsChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('tile-c1')).toBeInTheDocument()
    expect(screen.getByTestId('tile-c2')).toBeInTheDocument()
    expect(screen.getByText('Вход')).toBeInTheDocument()
    expect(screen.getByText('Двор')).toBeInTheDocument()
  })

  it('drags a tile: pointer down, move and up produce a new position', () => {
    const onLayoutsChange = vi.fn()
    const layouts = startLayout()

    render(
      <CameraCanvas
        cameras={cameras}
        layouts={layouts}
        mode="edit"
        selectedId="c1"
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onLayoutsChange={onLayoutsChange}
      />,
    )

    const tile = screen.getByTestId('tile-c1')

    fireEvent.pointerDown(tile, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(tile, { clientX: 10, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(tile, { clientX: 10, clientY: 5, pointerId: 1 })

    expect(onLayoutsChange).toHaveBeenCalled()
    const next = onLayoutsChange.mock.calls.at(-1)?.[0] as Record<string, CameraLayout>

    expect(next.c1.x).toBe(layouts.c1.x + 10)
    expect(next.c1.y).toBe(layouts.c1.y + 5)
    expect(next.c1).not.toEqual(layouts.c1)
  })

  it('resizes a tile from a corner handle', () => {
    const onLayoutsChange = vi.fn()
    const layouts = startLayout()

    render(
      <CameraCanvas
        cameras={cameras}
        layouts={layouts}
        mode="edit"
        selectedId="c1"
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onLayoutsChange={onLayoutsChange}
      />,
    )

    const handle = screen.getByTestId('resize-se')

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 32, clientY: 18, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 32, clientY: 18, pointerId: 1 })

    const next = onLayoutsChange.mock.calls.at(-1)?.[0] as Record<string, CameraLayout>

    // scale is 1, so the screen delta maps 1:1 onto width and height.
    expect(next.c1.w).toBe(352)
    expect(next.c1.h).toBe(198)
    // The opposite corner stays anchored.
    expect(next.c1.x).toBe(layouts.c1.x)
    expect(next.c1.y).toBe(layouts.c1.y)
  })

  it('rotates a tile around its centre', () => {
    const onLayoutsChange = vi.fn()

    render(
      <CameraCanvas
        cameras={cameras}
        layouts={startLayout()}
        mode="edit"
        selectedId="c1"
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onLayoutsChange={onLayoutsChange}
      />,
    )

    // The mocked rect puts the centre at (160, 90). Grabbing the top dot is
    // -90deg from the centre; dragging to the right of it is 0deg, so the tile
    // turns a quarter clockwise.
    const handle = screen.getByTestId('rotate')

    fireEvent.pointerDown(handle, { clientX: 160, clientY: -10, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 330, clientY: 90, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 330, clientY: 90, pointerId: 1 })

    const next = onLayoutsChange.mock.calls.at(-1)?.[0] as Record<string, CameraLayout>

    expect(next.c1.rotation).toBe(90)
    expect(next.c1.x).toBe(0)
    expect(next.c1.y).toBe(0)
  })

  it('ignores gestures outside edit mode', () => {
    const onLayoutsChange = vi.fn()

    render(
      <CameraCanvas
        cameras={cameras}
        layouts={startLayout()}
        mode="view"
        selectedId={null}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        onLayoutsChange={onLayoutsChange}
      />,
    )

    const tile = screen.getByTestId('tile-c1')

    fireEvent.pointerDown(tile, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(tile, { clientX: 10, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(tile, { clientX: 10, clientY: 5, pointerId: 1 })

    expect(onLayoutsChange).not.toHaveBeenCalled()
  })
})
