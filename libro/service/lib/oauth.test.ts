import { describe, expect, it } from 'vitest'
import { normalizeScope } from './oauth'
import { ServiceError } from './errors'
import { isValidHandle, normalizeHandle } from './handles'

describe('OAuth and identity input policy', () => {
  it('deduplicates supported scopes', () => {
    expect(normalizeScope('openid profile publish publish')).toEqual(['openid', 'profile', 'publish'])
  })

  it('rejects unknown scopes with the stable service error', () => {
    expect(() => normalizeScope('openid admin')).toThrowError(ServiceError)
    try {
      normalizeScope('admin')
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_scope', status: 400, retryable: false })
    }
  })

  it('normalizes handles without widening the protocol grammar', () => {
    expect(normalizeHandle('  Alice_01 ')).toBe('alice_01')
    expect(isValidHandle('alice_01')).toBe(true)
    expect(isValidHandle('ab')).toBe(false)
    expect(isValidHandle('alice.example')).toBe(false)
  })
})
