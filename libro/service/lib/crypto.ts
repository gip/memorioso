import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomHex(bytes = 32): `0x${string}` {
  return `0x${randomBytes(bytes).toString('hex')}`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function verifySecret(value: string, hash: string | null): boolean {
  if (!hash) return false
  const actual = Buffer.from(sha256(value))
  const expected = Buffer.from(hash)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function signState(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyState<T>(value: string, secret: string): T | null {
  const [body, signature] = value.split('.')
  if (!body || !signature) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

export function deriveCapability(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`libro:signing-capability:${id}`).digest('base64url')
}
