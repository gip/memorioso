import { AsyncLocalStorage } from 'node:async_hooks'
import { ServiceError } from '@/lib/errors'
import { serviceOrigin } from '@/lib/config'

export const mcpRequestContext = new AsyncLocalStorage<{ request: Request; responseHeaders: Headers }>()

export function currentMcpRequest(): Request {
  const context = mcpRequestContext.getStore()
  if (!context) throw new Error('MCP request context is missing')
  return context.request
}

export function assertBrowserOrigin(): void {
  if (currentMcpRequest().headers.get('origin') !== serviceOrigin()) {
    throw new ServiceError('INVALID_ORIGIN', 'Browser tools require the Libro origin', 403)
  }
}

// Tool execution can finish after the transport creates its response. Collect
// cookies until that response completes, before committing any HTTP headers.
export function setBrowserCookie(name: string, value: string, options: {
  maxAge: number; secure: boolean; httpOnly: boolean; sameSite: 'lax'; path: string
}): void {
  const context = mcpRequestContext.getStore()
  if (!context) throw new Error('MCP request context is missing')
  context.responseHeaders.append('Set-Cookie', `${name}=${value}; Path=${options.path}; Max-Age=${options.maxAge}; HttpOnly; SameSite=Lax${options.secure ? '; Secure' : ''}`)
}
