import { describe, expect, it, vi } from 'vitest'
import { createLibroMcpClient } from './mcp-client'

function transport(result: unknown, sse = false) {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const rpc = JSON.parse(String(options?.body))
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const body = { jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize' ? { protocolVersion: '2025-06-18' } : result }
    return sse
      ? new Response(`: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(body)}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json(body)
  })
}

describe('Libro website MCP transport', () => {
  it.each([false, true])('initializes once and reads JSON or SSE (%s)', async (sse) => {
    const fetcher = transport({ content: [{ type: 'text', text: '[{"id":"1"}]' }] }, sse)
    const client = createLibroMcpClient('https://libro.test/mcp', { fetch: fetcher, headers: { Authorization: 'Bearer token' } })
    expect(await client.callTool('list_publications')).toEqual([{ id: '1' }])
    await client.callTool('list_publications', { limit: 1 })
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).method))
      .toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
    const headers = new Headers(fetcher.mock.calls[2][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer token')
    expect(headers.get('MCP-Protocol-Version')).toBe('2025-06-18')
    expect(headers.get('Accept')).toBe('application/json, text/event-stream')
  })

  it('retains structured authorization errors and never retries a mutation', async () => {
    const fetcher = transport({ isError: true, structuredContent: { error: { code: 'REAUTH_REQUIRED', message: 'Verify again', status: 403, retryable: false } } })
    await expect(createLibroMcpClient('https://libro.test/mcp', { fetch: fetcher }).callTool('create_human_publication'))
      .rejects.toMatchObject({ code: 'REAUTH_REQUIRED', status: 403, message: 'Verify again' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not replay a tool after a dropped response', async () => {
    const fetcher = transport({})
    const base = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (url, options) => {
      if (JSON.parse(String(options?.body)).method === 'tools/call') throw new Error('Connection lost')
      return base(url, options)
    })
    await expect(createLibroMcpClient('https://libro.test/mcp', { fetch: fetcher }).callTool('signing_finalize')).rejects.toThrow('Connection lost')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('rejects mismatched RPC responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 'another-request', result: {} }))
    await expect(createLibroMcpClient('https://libro.test/mcp', { fetch: fetcher }).callTool('whoami')).rejects.toMatchObject({ code: 'INVALID_MCP_RESPONSE' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
