import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export const AUTH_SESSION_COOKIE = 'memorioso_world_id_session' as const
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

type AuthSessionPayload = {
  v: 1
  userId: number
  worldIdSessionId: string
  iat: number
  exp: number
}

function requireSessionSecret(): string {
  const value = process.env.SESSION_SECRET
  if (!value) {
    throw new Error('SESSION_SECRET is required')
  }
  return value
}

function sign(value: string): string {
  return createHmac('sha256', requireSessionSecret())
    .update(value)
    .digest('base64url')
}

function encodePayload(payload: AuthSessionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodePayload(value: string): AuthSessionPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<AuthSessionPayload>
    if (
      payload.v !== 1 ||
      typeof payload.userId !== 'number' ||
      typeof payload.worldIdSessionId !== 'string' ||
      payload.worldIdSessionId.length === 0 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }

    return payload as AuthSessionPayload
  } catch {
    return null
  }
}

export function createAuthSessionToken(userId: number, worldIdSessionId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const encodedPayload = encodePayload({
    v: 1,
    userId,
    worldIdSessionId,
    iat: now,
    exp: now + AUTH_SESSION_MAX_AGE_SECONDS,
  })

  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyAuthSessionToken(token: string | undefined): AuthSessionPayload | null {
  if (!token) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = sign(encodedPayload)
  const signatureBuffer = Buffer.from(signature)
  const expectedSignatureBuffer = Buffer.from(expectedSignature)
  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null
  }

  const payload = decodePayload(encodedPayload)
  if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null
  }

  return payload
}

export async function getAuthSessionPayload(): Promise<AuthSessionPayload | null> {
  const cookieStore = await cookies()
  return verifyAuthSessionToken(cookieStore.get(AUTH_SESSION_COOKIE)?.value)
}

export function getAuthSessionCookieOptions(maxAge = AUTH_SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}
