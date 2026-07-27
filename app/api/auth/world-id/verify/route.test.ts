import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({ verifyAndCreateOrConnectAuthor: vi.fn() }))

vi.mock('@/lib/world-id/author-auth', () => {
  class WorldIdAuthorAuthError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
      readonly verifierResponse?: unknown,
    ) {
      super(message)
    }
  }

  return {
    verifyAndCreateOrConnectAuthor: authMock.verifyAndCreateOrConnectAuthor,
    WorldIdAuthorAuthError,
  }
})

import { AUTH_SESSION_COOKIE } from '@/lib/auth-session'
import {
  WORLD_ID_AUTH_NONCE_COOKIE,
  WORLD_ID_SESSION_HINT_COOKIE,
} from '@/lib/world-id/constants'
import { WorldIdAuthorAuthError } from '@/lib/world-id/author-auth'
import { POST } from './route'

function request(
  body: Record<string, unknown>,
  cookieNonce = 'nonce-1',
): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/worldid/verify', {
    method: 'POST',
    headers: cookieNonce
      ? { cookie: `${WORLD_ID_AUTH_NONCE_COOKIE}=${cookieNonce}` }
      : {},
    body: JSON.stringify(body),
  })
}

const account = {
  user: {
    id: 9,
    subject: 'world-id-session:new',
    handle: 'new_writer',
    worldIdSessionId: 'session_new',
    worldIdCredentialIdentifier: 'proof_of_human',
  },
  author: {
    id: 'author-9',
    name: 'new_writer',
    handle: 'new_writer',
    bio: null,
  },
  created: true,
  transport: undefined,
}

describe('web World ID auth transport', () => {
  const originalSessionSecret = process.env.SESSION_SECRET

  beforeEach(() => {
    authMock.verifyAndCreateOrConnectAuthor.mockReset()
    authMock.verifyAndCreateOrConnectAuthor.mockResolvedValue(account)
    process.env.SESSION_SECRET = 'test-session-secret'
  })

  afterEach(() => {
    if (originalSessionSecret === undefined) {
      delete process.env.SESSION_SECRET
    } else {
      process.env.SESSION_SECRET = originalSessionSecret
    }
  })

  it('uses the shared service for signup and returns web session cookies', async () => {
    const response = await POST(request({
      payload: { nonce: 'nonce-1', proof: true },
      intent: 'signup',
      handle: ' New_Writer ',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      authenticated: true,
      user: { handle: 'new_writer' },
    })
    expect(authMock.verifyAndCreateOrConnectAuthor).toHaveBeenCalledWith({
      idkitResult: { nonce: 'nonce-1', proof: true },
      nonce: 'nonce-1',
      intent: 'signup',
      profile: {
        handle: 'new_writer',
        name: 'new_writer',
        bio: '',
      },
    })
    expect(response.cookies.get(AUTH_SESSION_COOKIE)?.value).toBeTruthy()
    expect(response.cookies.get(WORLD_ID_SESSION_HINT_COOKIE)?.value).toBe('session_new')
    expect(response.cookies.get(WORLD_ID_AUTH_NONCE_COOKIE)?.value).toBe('')
  })

  it('keeps login transport profile-free', async () => {
    const response = await POST(request({
      payload: { nonce: 'nonce-1', proof: true },
      intent: 'login',
      handle: 'new_writer',
    }))

    expect(response.status).toBe(200)
    expect(authMock.verifyAndCreateOrConnectAuthor).toHaveBeenCalledWith({
      idkitResult: { nonce: 'nonce-1', proof: true },
      nonce: 'nonce-1',
      intent: 'login',
      profile: undefined,
    })
  })

  it('rejects a missing or mismatched nonce cookie before calling the service', async () => {
    const response = await POST(request({
      payload: { nonce: 'nonce-other', proof: true },
      intent: 'signup',
      handle: 'new_writer',
    }, 'nonce-1'))

    expect(response.status).toBe(400)
    expect(authMock.verifyAndCreateOrConnectAuthor).not.toHaveBeenCalled()
  })

  it('maps shared proof errors without changing the web response contract', async () => {
    authMock.verifyAndCreateOrConnectAuthor.mockRejectedValueOnce(
      new WorldIdAuthorAuthError(
        'World ID verifier rejected the login proof',
        401,
        'VERIFIER_REJECTED',
        { success: false },
      ),
    )

    const response = await POST(request({
      payload: { nonce: 'nonce-1', proof: true },
      intent: 'signup',
      handle: 'new_writer',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      message: 'World ID verifier rejected the login proof',
      verifierResponse: { success: false },
    })
  })
})
