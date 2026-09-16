/** The stateless Streamable HTTP subset used by Libro's website clients. */
export class LibroMcpError extends Error {
  constructor(message: string, public readonly code = 'MCP_ERROR', public readonly status = 502, public readonly retryable = false) {
    super(message)
    this.name = 'LibroMcpError'
  }
}

type RpcMessage = {
  jsonrpc: string
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

type ToolResult = {
  isError?: boolean
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
}

async function readRpc(response: Response, id: string): Promise<unknown> {
  if (!response.ok) throw new LibroMcpError(`Libro MCP returned HTTP ${response.status}`, 'MCP_HTTP_ERROR', response.status)
  const source = await response.text()
  const parse = (text: string): RpcMessage => {
    try { return JSON.parse(text) }
    catch { throw new LibroMcpError('Libro returned malformed MCP data', 'INVALID_MCP_RESPONSE') }
  }
  const messages: RpcMessage[] = response.headers.get('content-type')?.includes('text/event-stream')
    ? source.replace(/\r\n/g, '\n').split('\n\n').flatMap((event) => {
      const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      return data ? [parse(data)] : []
    })
    : [parse(source)]
  const message = messages.find((value) => value?.jsonrpc === '2.0' && value.id === id)
  if (!message) throw new LibroMcpError('Libro returned no matching MCP response', 'INVALID_MCP_RESPONSE')
  if (message.error) throw new LibroMcpError(message.error.message, String(message.error.code))
  if (message.result === undefined) throw new LibroMcpError('Libro returned no MCP result', 'INVALID_MCP_RESPONSE')
  return message.result
}

export function createLibroMcpClient(endpoint: string, options: { headers?: HeadersInit; fetch?: typeof fetch } = {}) {
  let initialized: Promise<void> | undefined
  let requestId = 0
  let protocolVersion = '2025-06-18'
  let sessionId: string | undefined
  const send = async (method: string, params: unknown, notification = false): Promise<unknown> => {
    const headers = new Headers(options.headers)
    headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json, text/event-stream')
    headers.set('MCP-Protocol-Version', protocolVersion)
    if (sessionId) headers.set('Mcp-Session-Id', sessionId)
    const id = `memorioso-${++requestId}`
    const response = await (options.fetch || fetch)(endpoint, {
      method: 'POST', headers, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    })
    if (notification) {
      if (!response.ok) throw new LibroMcpError('Libro MCP initialization failed', 'MCP_HTTP_ERROR', response.status)
      await response.body?.cancel()
      return
    }
    const result = await readRpc(response, id)
    if (method === 'initialize') sessionId = response.headers.get('Mcp-Session-Id') || undefined
    return result
  }
  return {
    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      initialized ??= (async () => {
        const result = await send('initialize', {
          protocolVersion, capabilities: {}, clientInfo: { name: 'memorioso', version: '1.0.0' },
        }) as { protocolVersion?: string }
        if (result.protocolVersion !== '2025-06-18') throw new LibroMcpError('Unsupported Libro MCP protocol version', 'MCP_VERSION_UNSUPPORTED')
        protocolVersion = result.protocolVersion
        await send('notifications/initialized', {}, true)
      })().catch((error) => { initialized = undefined; throw error })
      await initialized
      // Never automatically retry tool calls: a timed-out mutation may have completed.
      const result = await send('tools/call', { name, arguments: args }) as ToolResult
      const value = result.structuredContent ?? (() => {
        const text = result.content?.find((item) => item.type === 'text')?.text
        if (text === undefined) throw new LibroMcpError('Libro returned no tool content', 'INVALID_MCP_RESPONSE')
        return JSON.parse(text)
      })()
      if (result.isError) {
        const error = value?.error
        throw new LibroMcpError(error?.message || 'Libro tool failed', error?.code, error?.status, error?.retryable)
      }
      return value as T
    },
  }
}
