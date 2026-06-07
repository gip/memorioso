import { createHmac } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createAuthSessionToken,
  verifyAuthSessionToken,
} from '../auth-session'

describe('wallet auth sessions', () => {
  it('binds the session token to a normalized wallet address', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')

    const token = createAuthSessionToken(42, '0x1234567890ABCDEF1234567890ABCDEF12345678')
    const payload = verifyAuthSessionToken(token)

    expect(payload).toMatchObject({
      v: 2,
      userId: 42,
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    })
  })

  it('rejects legacy World ID session payloads', () => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')

    const legacyPayload = Buffer.from(JSON.stringify({
      v: 1,
      userId: 42,
      worldIdSessionId: 'world-id-login:memorioso-login-v1:0xabc',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    })).toString('base64url')
    const legacySignature = createHmac('sha256', 'test-session-secret')
      .update(legacyPayload)
      .digest('base64url')

    expect(verifyAuthSessionToken(`${legacyPayload}.${legacySignature}`)).toBeNull()
  })
})
