import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
import { GET as hint } from '../hint/route'
import { LIBRO_SESSION_COOKIE, LIBRO_WORLD_SESSION_HINT_COOKIE } from '@/lib/session'

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(), set: vi.fn(), verifyIdentity: vi.fn(), query: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: async () => ({
  get: (name: string) => mocks.values.has(name) ? { value: mocks.values.get(name) } : undefined,
  set: mocks.set,
}) }))
vi.mock('@/lib/world-id', () => ({ verifyIdentity: mocks.verifyIdentity }))
vi.mock('@/lib/db', () => ({ pool: { query: mocks.query } }))

beforeEach(() => {
  vi.stubEnv('LIBRO_SESSION_SECRET', 'test-session-secret')
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
  mocks.values.clear()
  mocks.set.mockImplementation((name: string, value: string) => mocks.values.set(name, value))
  mocks.verifyIdentity.mockResolvedValue({ identityId: 'identity-1' })
  mocks.query.mockResolvedValue({ rows: [{ id: 'identity-1', handle: 'alice' }] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })

it.each(['signup', 'login'])('remembers a verified %s for a year and proposes it after logout without authenticating', async (purpose) => {
  const sessionId = `session_${'ab'.repeat(64)}`
  const response = await POST(new Request('https://libro.test/api/v1/identity/verify', {
    method: 'POST', body: JSON.stringify({ purpose, handle: 'alice', payload: { session_id: sessionId } }),
  }))
  expect(response.status).toBe(200)
  expect(mocks.set).toHaveBeenCalledWith(LIBRO_WORLD_SESSION_HINT_COOKIE, expect.any(String), expect.objectContaining({
    maxAge: 365 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax',
  }))
  expect(mocks.set).toHaveBeenCalledWith(LIBRO_SESSION_COOKIE, expect.any(String), expect.objectContaining({ maxAge: 24 * 60 * 60 }))
  mocks.values.delete(LIBRO_SESSION_COOKIE)
  expect(await (await hint()).json()).toEqual({ continueAs: 'alice', authenticated: false })
  expect(mocks.query).toHaveBeenCalledWith(expect.any(String), [null, sessionId])
})

it('does not remember a name when World verification fails', async () => {
  mocks.verifyIdentity.mockRejectedValue(new Error('Invalid proof'))
  const response = await POST(new Request('https://libro.test/api/v1/identity/verify', {
    method: 'POST', body: JSON.stringify({ purpose: 'login', handle: 'alice', payload: {} }),
  }))
  expect(response.status).toBe(500)
  expect(mocks.set).not.toHaveBeenCalled()
})
