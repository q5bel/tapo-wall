import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toolbar } from '@/components/Toolbar'

afterEach(cleanup)

function renderToolbar(mode: 'view' | 'edit' = 'view') {
  const props = {
    mode,
    onModeChange: vi.fn(),
    onlineCount: 1,
    totalCount: 2,
    onAutoArrange: vi.fn(),
    onOpenSettings: vi.fn(),
  }
  render(<Toolbar {...props} />)
  return props
}

describe('Toolbar', () => {
  it('switches the mode', () => {
    const props = renderToolbar('view')

    fireEvent.click(screen.getByRole('tab', { name: 'Раскладка' }))

    expect(props.onModeChange).toHaveBeenCalledWith('edit')
  })

  it('shows the auto-arrange button only in edit mode', () => {
    const view = renderToolbar('view')
    expect(screen.queryByRole('button', { name: /Прибрать/ })).not.toBeInTheDocument()
    cleanup()

    const edit = renderToolbar('edit')
    fireEvent.click(screen.getByRole('button', { name: /Прибрать/ }))
    expect(edit.onAutoArrange).toHaveBeenCalledTimes(1)
  })

  it('opens settings', () => {
    const props = renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: /Настройки/ }))

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
