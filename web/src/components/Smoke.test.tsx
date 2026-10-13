import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('renders a div into jsdom', () => {
    render(<div>hello</div>)

    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
