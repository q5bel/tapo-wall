import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DEFAULT_LAYOUT } from '@/lib/layout'
import type { ConfigView } from '@/lib/types'

// Radix UI (Dialog) needs a couple of browser APIs jsdom does not provide.
beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} })),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeConfig(): ConfigView {
  return {
    httpPort: 3000,
    authEnabled: false,
    mediamtx: { hlsAddress: ':8888', apiAddress: ':9997', webrtcAddress: ':8889' },
    cameras: [
      {
        id: 'cam1',
        name: 'Офис',
        host: '192.168.1.101',
        port: 554,
        username: 'tapo',
        passwordSet: true,
        streams: { hd: '/stream1', preview: '/stream2' },
        layout: DEFAULT_LAYOUT,
      },
      {
        id: 'cam2',
        name: 'Склад',
        host: '192.168.1.102',
        port: 554,
        username: 'tapo',
        passwordSet: false,
        streams: { hd: '/stream1', preview: '/stream2' },
        layout: DEFAULT_LAYOUT,
      },
    ],
  }
}

function renderDialog(onSave = vi.fn(async () => {})) {
  return render(
    <SettingsDialog open config={makeConfig()} onSave={onSave} saving={false} onOpenChange={() => {}} />,
  )
}

describe('SettingsDialog', () => {
  it('lists the cameras', () => {
    renderDialog()

    expect(screen.getByText('Офис')).toBeInTheDocument()
    expect(screen.getByText('Склад')).toBeInTheDocument()
  })

  it('adds a camera from the form', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить камеру' }))

    fireEvent.change(screen.getByLabelText('id'), { target: { value: 'cam3' } })
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Двор' } })
    fireEvent.change(screen.getByLabelText('host'), { target: { value: '192.168.1.103' } })
    fireEvent.change(screen.getByLabelText('port'), { target: { value: '554' } })
    fireEvent.change(screen.getByLabelText('username'), { target: { value: 'tapo' } })
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'secret' } })

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить камеру' }))

    expect(screen.getByText('Двор')).toBeInTheDocument()
  })

  it('removes a camera', () => {
    renderDialog()

    const removeButtons = screen.getAllByRole('button', { name: 'Удалить' })
    fireEvent.click(removeButtons[0]!)

    expect(screen.queryByText('Офис')).not.toBeInTheDocument()
    expect(screen.getByText('Склад')).toBeInTheDocument()
  })

  it('omits the password field for cameras whose password was not edited', async () => {
    const onSave = vi.fn(async () => {})
    renderDialog(onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить настройки' }))

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    const input = onSave.mock.calls[0]![0] as { cameras: Array<Record<string, unknown>> }
    expect(input.cameras).toHaveLength(2)
    for (const camera of input.cameras) {
      expect(camera).not.toHaveProperty('password')
    }
  })
})
