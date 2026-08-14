import { describe, expect, it } from 'vitest'
import {
  isValidUserHandle,
  normalizeUserHandle,
  parseAuthorHandlePathSegment,
} from '@/lib/handle'

describe('normalizeUserHandle', () => {
  it('lowercases and trims', () => {
    expect(normalizeUserHandle('  JohNN ')).toBe('johnn')
  })
})

describe('isValidUserHandle', () => {
  it('accepts lowercase alphanumerics with - and _', () => {
    expect(isValidUserHandle('johnn')).toBe(true)
    expect(isValidUserHandle('jo-hn_2')).toBe(true)
    expect(isValidUserHandle('a1b')).toBe(true)
  })

  it('rejects short, long, uppercase, and bad characters', () => {
    expect(isValidUserHandle('jo')).toBe(false)
    expect(isValidUserHandle('a'.repeat(33))).toBe(false)
    expect(isValidUserHandle('JohNN')).toBe(false)
    expect(isValidUserHandle('-john')).toBe(false)
    expect(isValidUserHandle('john doe')).toBe(false)
    expect(isValidUserHandle('john.doe')).toBe(false)
    expect(isValidUserHandle('')).toBe(false)
  })
})

describe('parseAuthorHandlePathSegment', () => {
  it('parses literal and percent-encoded author path segments', () => {
    expect(parseAuthorHandlePathSegment('@jacko22')).toBe('jacko22')
    expect(parseAuthorHandlePathSegment('%40jacko22')).toBe('jacko22')
  })

  it('rejects malformed or non-author path segments', () => {
    expect(parseAuthorHandlePathSegment('jacko22')).toBeNull()
    expect(parseAuthorHandlePathSegment('%')).toBeNull()
    expect(parseAuthorHandlePathSegment('%2540jacko22')).toBeNull()
    expect(parseAuthorHandlePathSegment('@Jo')).toBeNull()
  })
})
