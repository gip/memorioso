import { describe, expect, it } from 'vitest'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'

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
