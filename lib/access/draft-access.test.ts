import { describe, expect, it } from 'vitest'
import { isPublicationAccess, validateAccessForKind } from './draft-access'

describe('isPublicationAccess', () => {
  it('accepts only the two known values', () => {
    expect(isPublicationAccess('public')).toBe(true)
    expect(isPublicationAccess('gated')).toBe(true)
    expect(isPublicationAccess('private')).toBe(false)
    expect(isPublicationAccess(undefined)).toBe(false)
  })
})

describe('validateAccessForKind', () => {
  it('allows gating an article', () => {
    expect(validateAccessForKind('gated', 'article')).toBeNull()
  })

  // A teaser of a short is the whole short, so gating one would be theatre.
  it('refuses to gate a short', () => {
    expect(validateAccessForKind('gated', 'short')).toBe('Shorts cannot be gated')
  })

  it('leaves public publications alone', () => {
    expect(validateAccessForKind('public', 'short')).toBeNull()
    expect(validateAccessForKind('public', 'article')).toBeNull()
  })
})
