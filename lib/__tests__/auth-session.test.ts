import { describe, expect, it, vi } from 'vitest'
import {
  createAuthSessionToken,
  verifyAuthSessionToken,
} from '../auth-session'

describe('World ID auth sessions', () => {
  it('binds the session token to a World ID session id', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')

    const worldIdSessionId = `session_${'a'.repeat(128)}`
    const token = createAuthSessionToken(42, worldIdSessionId)
    const payload = verifyAuthSessionToken(token)

    expect(payload).toMatchObject({
      v: 1,
      userId: 42,
      worldIdSessionId,
    })
  })

  it('rejects a tampered session token', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')

    const token = createAuthSessionToken(42, `session_${'a'.repeat(128)}`)
    expect(verifyAuthSessionToken(`${token.slice(0, -1)}x`)).toBeNull()
  })
})
