import { createLibroMcpClient, LibroMcpError, type LIBRO_BROWSER_MCP_TOOLS } from '@libro/core'

const client = createLibroMcpClient('/api/libro/browser/mcp')

export async function browserMcp<T>(name: typeof LIBRO_BROWSER_MCP_TOOLS[number], args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await client.callTool<T>(name, args)
  } catch (error) {
    if (error instanceof LibroMcpError && error.status === 401) {
      window.location.assign(`/libro/identity?continue=${encodeURIComponent(window.location.href)}`)
    }
    throw error
  }
}
