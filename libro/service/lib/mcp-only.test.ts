import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('exposes only the MCP application route on Libro', async () => {
  const entries = await readdir(new URL('../app/', import.meta.url), { recursive: true })
  const routes = entries.filter((entry) => /(?:^|\/)(?:route|page)\.[jt]sx?$/.test(entry)).sort()
  expect(routes).toEqual(['mcp/route.ts'])
})
