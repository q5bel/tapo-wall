import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('returns a string', () => {
    expect(typeof cn('a', 'b')).toBe('string')
  })
})
