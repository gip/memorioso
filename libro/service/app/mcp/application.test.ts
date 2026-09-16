import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibroMcpClient, LIBRO_BROWSER_MCP_TOOLS } from '@libro/core'

const mocks = vi.hoisted(() => ({ verify: vi.fn(), query: vi.fn(), list: vi.fn(), serviceAuth: vi.fn(), signing: vi.fn(), authenticate: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: { query: mocks.query } }))
vi.mock('@/lib/world-id', () => ({ verifyIdentity: mocks.verify }))
vi.mock('@/lib/publications', () => ({ listPublications: mocks.list }))
vi.mock('@/lib/service-auth', () => ({ authenticateServiceClient: mocks.serviceAuth }))
vi.mock('@/lib/oauth', () => ({ authenticateBearer: mocks.authenticate }))
vi.mock('@/lib/human-signing', () => ({ signingContext: mocks.signing }))

import { POST } from './route'
import { ServiceError } from '@/lib/errors'

function client(origin = 'https://libro.test', authorization?: string) {
  const responses: Response[] = []
  const methods: string[] = []
  const fetcher: typeof fetch = async (url, options) => {
    methods.push(JSON.parse(String(options?.body)).method)
    const response = await POST(new Request(String(url), options))
    responses.push(response.clone())
    return response
  }
  return { responses, methods, mcp: createLibroMcpClient('https://libro.test/mcp', {
    fetch: fetcher, headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}) },
  }) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
  vi.stubEnv('LIBRO_MCP_STATE_SECRET', 'test-state-secret-that-is-at-least-32-bytes')
  vi.stubEnv('LIBRO_SESSION_SECRET', 'test-cookie-secret')
  vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
})

describe('website calls through the Libro MCP transport', () => {
  it('initializes and returns verified identity cookies on the MCP response', async () => {
    mocks.verify.mockResolvedValue({ identityId: 'identity-one' })
    const value = client()
    expect(await value.mcp.callTool('identity_verify', { purpose: 'signup', handle: 'alice', payload: { session_id: `session_${'ab'.repeat(64)}` } }))
      .toEqual({ success: true, identity: { identityId: 'identity-one' } })
    expect(value.methods).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    const cookies = value.responses[2].headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('libro_identity_session=')
    expect(cookies[0]).toContain('HttpOnly')
    expect(cookies[1]).toContain('libro_world_session_hint=')
    expect(value.responses[2].headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not set cookies when proof verification fails', async () => {
    mocks.verify.mockRejectedValue(new ServiceError('INVALID_PROOF', 'Proof failed', 400))
    const value = client()
    await expect(value.mcp.callTool('identity_verify', { purpose: 'login', payload: {} })).rejects.toMatchObject({ code: 'INVALID_PROOF', status: 400 })
    expect(value.responses[2].headers.getSetCookie()).toEqual([])
  })

  it('rejects cross-origin browser calls before checking a proof', async () => {
    await expect(client('https://attacker.test').mcp.callTool('identity_verify', { purpose: 'login', payload: {} }))
      .rejects.toMatchObject({ code: 'INVALID_ORIGIN', status: 403 })
    expect(mocks.verify).not.toHaveBeenCalled()
  })

  it('retains signing ownership errors and prepared-operation recovery', async () => {
    mocks.signing.mockRejectedValueOnce(new ServiceError('IDENTITY_MISMATCH', 'Another identity owns this request', 403))
    const value = client()
    await expect(value.mcp.callTool('signing_context', { capability: 'cap' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH', status: 403 })
    mocks.signing.mockResolvedValueOnce({ prepared: { registrationId: 'reg', transactionHash: '0x123' } })
    expect(await value.mcp.callTool('signing_context', { capability: 'cap' })).toEqual({ prepared: { registrationId: 'reg', transactionHash: '0x123' } })
    expect(mocks.signing).toHaveBeenCalledWith(expect.any(Request), 'cap')
  })

  it('requires matching service authority for a scoped feed and never falls back to a global feed', async () => {
    mocks.serviceAuth.mockResolvedValue('memorioso')
    mocks.list.mockResolvedValue([{ id: 'publication' }])
    const value = client('https://libro.test', 'Service memorioso.secret')
    expect(await value.mcp.callTool('list_publications', { originClientId: 'memorioso' })).toEqual([{ id: 'publication' }])
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ originClientId: 'memorioso' }))
    mocks.list.mockClear()
    await expect(value.mcp.callTool('list_publications', { originClientId: 'other' })).rejects.toMatchObject({ code: 'ORIGIN_MISMATCH' })
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('keeps public reads anonymous and service-only counts protected', async () => {
    mocks.list.mockResolvedValue([])
    const value = client()
    expect(await value.mcp.callTool('list_publications')).toEqual([])
    expect(mocks.serviceAuth).not.toHaveBeenCalled()
    mocks.serviceAuth.mockRejectedValue(new ServiceError('AUTH_REQUIRED', 'Service credentials required', 401))
    await expect(value.mcp.callTool('publication_counts', { authorId: '11111111-1111-4111-8111-111111111111' })).rejects.toMatchObject({ status: 401 })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('exposes every browser tool in discovery', async () => {
    const response = await POST(new Request('https://libro.test/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))
    const wire = await response.text()
    const data = wire.split('\n').find((line) => line.startsWith('data:'))?.slice(5) || wire
    const names = JSON.parse(data).result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual(expect.arrayContaining([...LIBRO_BROWSER_MCP_TOOLS]))
  })
})

describe('operational MCP tools', () => {
  it('reports health without credentials or database access', async () => {
    expect(await client().mcp.callTool('health')).toEqual({ success: true, service: 'libro', writesEnabled: true })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })

  it.each([undefined, 'Internal incorrect', 'Service memorioso.secret'])('rejects unauthorized delivery (%s)', async (authorization) => {
    vi.stubEnv('LIBRO_INTERNAL_CRON_SECRET', 'internal-only-secret')
    await expect(client('https://libro.test', authorization).mcp.callTool('deliver_events')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('allows only the internal credential to start event delivery', async () => {
    vi.stubEnv('LIBRO_INTERNAL_CRON_SECRET', 'internal-only-secret')
    vi.stubEnv('LIBRO_WEBHOOK_DESTINATIONS', '')
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
    expect(await client('https://libro.test', 'Internal internal-only-secret').mcp.callTool('deliver_events'))
      .toEqual({ attempted: 0, delivered: 0 })
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })

  it('does not grant user authority to an internal credential', async () => {
    vi.stubEnv('LIBRO_INTERNAL_CRON_SECRET', 'internal-only-secret')
    await expect(client('https://libro.test', 'Internal internal-only-secret').mcp.callTool('whoami')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})
