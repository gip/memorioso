import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const LIBRO_OAUTH_FLOW_COOKIE = 'memorioso_libro_oauth_flow'

export type LibroOAuthFlow = {
  state: string
  verifier: string
  returnTo: string
  expiresAt: number
}

function secret(): string {
  const value = process.env.SESSION_SECRET
  if (!value) throw new Error('SESSION_SECRET is required')
  return value
}

export function beginLibroOAuthFlow(returnTo: string): { flow: LibroOAuthFlow; cookie: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const flow = {
    state: randomBytes(24).toString('base64url'),
    verifier,
    returnTo: returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/',
    expiresAt: Date.now() + 10 * 60_000,
  }
  const body = Buffer.from(JSON.stringify(flow)).toString('base64url')
  const signature = createHmac('sha256', secret()).update(body).digest('base64url')
  return {
    flow,
    cookie: `${body}.${signature}`,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function readLibroOAuthFlow(value: string | undefined): LibroOAuthFlow | null {
  if (!value) return null
  const [body, signature] = value.split('.')
  if (!body || !signature) return null
  const expected = createHmac('sha256', secret()).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LibroOAuthFlow
    return flow.expiresAt > Date.now() ? flow : null
  } catch {
    return null
  }
}
