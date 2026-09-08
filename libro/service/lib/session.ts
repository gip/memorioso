import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

export const LIBRO_SESSION_COOKIE = 'libro_identity_session'
export const LIBRO_WORLD_SESSION_HINT_COOKIE = 'libro_world_session_hint'
const MAX_AGE_SECONDS = 24 * 60 * 60

type Session = { v: 1; identityId: string; iat: number; exp: number }

function secret(): string {
  const value = process.env.LIBRO_SESSION_SECRET
  if (!value) throw new Error('LIBRO_SESSION_SECRET is required')
  return value
}

function signature(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

export function createIdentitySession(identityId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const body = Buffer.from(JSON.stringify({
    v: 1,
    identityId,
    iat: now,
    exp: now + MAX_AGE_SECONDS,
  } satisfies Session)).toString('base64url')
  return `${body}.${signature(body)}`
}

export function createWorldSessionHint(sessionId: string): string {
  const body = Buffer.from(sessionId).toString('base64url')
  return `${body}.${signature(`world-session:${body}`)}`
}

export function verifyWorldSessionHint(value: string | undefined): string | null {
  if (!value) return null
  const [body, supplied] = value.split('.')
  if (!body || !supplied) return null
  const expected = signature(`world-session:${body}`)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  const sessionId = Buffer.from(body, 'base64url').toString('utf8')
  return /^session_[0-9a-f]{128}$/i.test(sessionId) ? sessionId : null
}

export function verifyIdentitySession(value: string | undefined): Session | null {
  if (!value) return null
  const [body, supplied] = value.split('.')
  if (!body || !supplied) return null
  const expected = signature(body)
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Session>
    if (parsed.v !== 1 || typeof parsed.identityId !== 'string' || typeof parsed.exp !== 'number') return null
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null
    return parsed as Session
  } catch {
    return null
  }
}

export async function browserIdentityId(): Promise<string | null> {
  const store = await cookies()
  return verifyIdentitySession(store.get(LIBRO_SESSION_COOKIE)?.value)?.identityId || null
}

export const identitySessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
}
