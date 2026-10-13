import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CameraTile } from '@/components/CameraTile'
import type { CameraLayout } from '@/lib/layout'
import type { Camera } from '@/lib/types'

// `test.globals` is false, so Testing Library cannot register its own
// auto-cleanup: every test must unmount what it rendered.
afterEach(cleanup)

/** jsdom has no media pipeline: `play()` is not implemented and would throw. */
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

const camera: Camera = {
  id: 'id',
  name: 'Вход',
  status: 'online',
  preview: { hls: '/preview.m3u8', webrtc: '/preview/whep' },
  hd: { hls: '/hd.m3u8', webrtc: '/hd/whep' },
}

const layout: CameraLayout = { x: 10, y: 20, w: 320, h: 180, rotation: 0, scale: 1 }

const noop = () => {}

describe('CameraTile', () => {
  it('positions itself from the layout and shows the camera name', () => {
    render(<CameraTile camera={camera} layout={layout} mode="view" onOpen={noop} />)

    const tile = screen.getByTestId('tile-id')

    expect(tile.style.transform).toBe('translate(10px, 20px) rotate(0deg) scale(1)')
    expect(screen.getByText('Вход')).toBeInTheDocument()
  })

  it('shows resize and rotate handles only when selected in edit mode', () => {
    render(
      <CameraTile camera={camera} layout={layout} mode="edit" selected onOpen={noop} />,
    )

    expect(screen.getByTestId('resize-nw')).toBeInTheDocument()
    expect(screen.getByTestId('rotate')).toBeInTheDocument()
  })

  it('hides the handles in edit mode when not selected', () => {
    render(<CameraTile camera={camera} layout={layout} mode="edit" onOpen={noop} />)

    expect(screen.queryByTestId('resize-nw')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rotate')).not.toBeInTheDocument()
  })

  it('opens the camera from the overlay button in view mode', () => {
    const onOpen = vi.fn()

    render(<CameraTile camera={camera} layout={layout} mode="view" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Открыть/ }))

    expect(onOpen).toHaveBeenCalledWith(camera)
  })

  it('selects the camera when the tile is clicked in edit mode', () => {
    const onSelect = vi.fn()

    render(
      <CameraTile
        camera={camera}
        layout={layout}
        mode="edit"
        onSelect={onSelect}
        onOpen={noop}
      />,
    )
    fireEvent.click(screen.getByTestId('tile-id'))

    expect(onSelect).toHaveBeenCalledWith('id')
  })

  it('reports the move gesture from the tile body in edit mode', () => {
    const onHandlePointerDown = vi.fn()

    render(
      <CameraTile
        camera={camera}
        layout={layout}
        mode="edit"
        onSelect={noop}
        onOpen={noop}
        onHandlePointerDown={onHandlePointerDown}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('tile-id'))

    expect(onHandlePointerDown).toHaveBeenCalledTimes(1)
    expect(onHandlePointerDown.mock.calls[0][1]).toBe('move')
  })

  it('reports the corner gesture from a resize handle without falling back to move', () => {
    const onHandlePointerDown = vi.fn()

    render(
      <CameraTile
        camera={camera}
        layout={layout}
        mode="edit"
        selected
        onSelect={noop}
        onOpen={noop}
        onHandlePointerDown={onHandlePointerDown}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('resize-se'))

    expect(onHandlePointerDown).toHaveBeenCalledTimes(1)
    expect(onHandlePointerDown.mock.calls[0][1]).toBe('resize-se')
  })
})
