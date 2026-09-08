import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.LIBRO_MCP_STATE_SECRET = 'test-state-secret-that-is-at-least-32-bytes'
  process.env.LIBRO_SERVICE_URL = 'https://libro.test'
})

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), read: vi.fn() }))

vi.mock('@/lib/openship', () => ({
  getOpenShipSnapshot: mocks.snapshot,
  readOpenShipFile: mocks.read,
}))

import { POST } from './route'

const manifest = {
  openship: '1.0',
  capability: 'sources',
  digest: `sha256:${'a'.repeat(64)}`,
  project: { name: 'Memorioso', description: 'A test source.' },
  totals: { files: 1, bytes: 6 },
  files: [{
    path: 'README.md',
    size: 6,
    sha256: 'b'.repeat(64),
    encoding: 'utf-8',
    mediaType: 'text/plain; charset=utf-8',
    type: 'file',
  }],
}

const snapshot = { origin: 'https://memorioso.test', manifest }

function decodeRpc(text: string) {
  if (!text.startsWith('event:') && !text.startsWith('data:')) return JSON.parse(text)
  const data = text.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
  if (!data) throw new Error(`No MCP data event in ${text}`)
  return JSON.parse(data)
}

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await POST(new Request('https://libro.test/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }))
  return { response, body: decodeRpc(await response.text()) }
}

describe('Libro MCP OpenShip binding', () => {
  beforeEach(() => {
    mocks.snapshot.mockReset().mockResolvedValue(snapshot)
    mocks.read.mockReset().mockResolvedValue({
      snapshot,
      file: { metadata: manifest.files[0], bytes: new TextEncoder().encode('hello\n') },
      content: 'hello\n',
    })
  })

  it('lists and calls the openship tool without authorization', async () => {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'anonymous-openship-test', version: '1.0.0' },
    })
    expect(initialized.response.status).toBe(200)
    expect(initialized.body.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: expect.objectContaining({ name: expect.any(String) }),
    })

    const listed = await rpc('tools/list')
    expect(listed.response.status).toBe(200)
    expect(listed.body.result.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'openship' }),
    ]))

    const called = await rpc('tools/call', {
      name: 'openship',
      arguments: { operation: 'manifest' },
    })
    expect(called.response.status).toBe(200)
    expect(called.body.result.isError).not.toBe(true)
    expect(JSON.parse(called.body.result.content[0].text)).toMatchObject({
      origin: 'https://memorioso.test',
      manifest: { project: { name: 'Memorioso' } },
    })

    const source = await rpc('tools/call', {
      name: 'openship',
      arguments: { operation: 'read', path: 'README.md' },
    })
    expect(JSON.parse(source.body.result.content[0].text)).toMatchObject({
      digest: manifest.digest,
      file: { path: 'README.md' },
      content: 'hello\n',
    })

    const protectedCall = await rpc('tools/call', { name: 'whoami', arguments: {} })
    expect(protectedCall.body.result.isError).toBe(true)
    expect(JSON.parse(protectedCall.body.result.content[0].text)).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    })
  })

  it('lists and reads the OpenShip manifest and file resources anonymously', async () => {
    const listed = await rpc('resources/list')
    expect(listed.body.result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ uri: 'openship://sources/manifest' }),
      expect.objectContaining({ name: 'README.md' }),
    ]))

    const read = await rpc('resources/read', {
      uri: 'openship://sources/file?path=README.md',
    })
    expect(read.body.result.contents[0]).toMatchObject({ text: 'hello\n' })
    expect(mocks.read).toHaveBeenCalledWith('README.md')
  })

  it('returns binary source resources as canonical base64 blobs', async () => {
    const binary = {
      path: 'public/icon.png',
      size: 4,
      sha256: 'c'.repeat(64),
      encoding: 'base64',
      mediaType: 'image/png',
      type: 'file',
    }
    mocks.read.mockResolvedValueOnce({
      snapshot,
      file: { metadata: binary, bytes: new Uint8Array([0, 1, 2, 3]) },
      content: 'AAECAw==',
    })

    const read = await rpc('resources/read', {
      uri: 'openship://sources/file?path=public%2Ficon.png',
    })
    expect(read.body.result.contents[0]).toMatchObject({
      uri: 'openship://sources/file?path=public%2Ficon.png',
      mimeType: 'image/png',
      blob: 'AAECAw==',
    })
  })
})
