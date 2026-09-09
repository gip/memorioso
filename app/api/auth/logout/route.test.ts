import { afterEach, expect, it, vi } from 'vitest'
import { AUTH_SESSION_COOKIE } from '@/lib/auth-session'
import { WORLD_ID_SESSION_HINT_COOKIE } from '@/lib/world-id/constants'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), clearTokens: vi.fn() }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: mocks.getUser }))
vi.mock('@/lib/libro-service/token-store', () => ({ clearLibroTokens: mocks.clearTokens }))

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it.each(['0', '1'])('clears authentication but preserves remembered login hints (service writes %s)', async (enabled) => {
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', enabled)
  mocks.getUser.mockResolvedValue({ id: 7 })
  mocks.clearTokens.mockResolvedValue(undefined)
  const response = await POST()
  expect(response.cookies.get(AUTH_SESSION_COOKIE)?.maxAge).toBe(0)
  for (const name of ['libro_identity_session', 'libro_oauth_consent']) {
    expect(response.cookies.get(name)).toMatchObject({ value: '', maxAge: 0, path: '/api/libro/browser' })
  }
  expect(response.cookies.get('libro_world_session_hint')).toBeUndefined()
  expect(response.cookies.get(WORLD_ID_SESSION_HINT_COOKIE)).toBeUndefined()
  if (enabled === '1') expect(mocks.clearTokens).toHaveBeenCalledWith(7)
  else expect(mocks.clearTokens).not.toHaveBeenCalled()
})
