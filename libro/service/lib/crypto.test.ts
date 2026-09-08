import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveCapability, sha256, signState, verifySecret, verifyState } from './crypto'
import {
  createIdentitySession,
  createWorldSessionHint,
  verifyIdentitySession,
  verifyWorldSessionHint,
} from './session'

describe('sealed Libro state', () => {
  const previous = process.env.LIBRO_SESSION_SECRET

  beforeEach(() => {
    process.env.LIBRO_SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes'
  })

  afterEach(() => {
    vi.useRealTimers()
    if (previous === undefined) delete process.env.LIBRO_SESSION_SECRET
    else process.env.LIBRO_SESSION_SECRET = previous
  })

  it('round-trips state and rejects tampering', () => {
    const value = signState({ tool: 'publish_human', subject: 'identity-1' }, 'secret')
    expect(verifyState(value, 'secret')).toEqual({ tool: 'publish_human', subject: 'identity-1' })
    expect(verifyState(`${value.slice(0, -1)}x`, 'secret')).toBeNull()
  })

  it('derives stable, purpose-bound capabilities', () => {
    expect(deriveCapability('challenge-1', 'secret')).toBe(deriveCapability('challenge-1', 'secret'))
    expect(deriveCapability('challenge-1', 'secret')).not.toBe(deriveCapability('challenge-2', 'secret'))
  })

  it('compares opaque client secrets by hash', () => {
    expect(verifySecret('correct', sha256('correct'))).toBe(true)
    expect(verifySecret('wrong', sha256('correct'))).toBe(false)
    expect(verifySecret('correct', null)).toBe(false)
  })

  it('keeps World session ids behind a same-origin signed hint', () => {
    const sessionId = `session_${'ab'.repeat(64)}`
    const hint = createWorldSessionHint(sessionId)
    expect(verifyWorldSessionHint(hint)).toBe(sessionId)
    expect(verifyWorldSessionHint(`${hint}x`)).toBeNull()
  })

  it('expires signed Libro browser sessions', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const session = createIdentitySession('00000000-0000-4000-8000-000000000001')
    expect(verifyIdentitySession(session)?.identityId).toBe('00000000-0000-4000-8000-000000000001')
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000)
    expect(verifyIdentitySession(session)).toBeNull()
  })
})
