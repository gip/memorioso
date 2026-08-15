import { describe, expect, it } from 'vitest'

import { isAuthRequiredPath } from './auth-routes'

describe('authenticated page routes', () => {
  it.each(['/activity', '/activity/', '/authors', '/authors/', '/info', '/info/'])(
    'requires authentication for %s',
    (pathname) => {
      expect(isAuthRequiredPath(pathname)).toBe(true)
    }
  )

  it('requires authentication for saved drafts but not new anonymous drafts', () => {
    expect(isAuthRequiredPath('/d/draft-123')).toBe(true)
    expect(isAuthRequiredPath('/d/draft-123/')).toBe(true)
    expect(isAuthRequiredPath('/d/new')).toBe(false)
  })

  it.each(['/', '/latest', '/article/publication-123'])(
    'allows public access to %s',
    (pathname) => {
      expect(isAuthRequiredPath(pathname)).toBe(false)
    }
  )
})
