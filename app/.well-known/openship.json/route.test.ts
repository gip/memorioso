import { afterEach, describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /.well-known/openship.json', () => {
  afterEach(() => {
    delete process.env.LIBRO_SERVICE_URL
  })

  it('advertises the v1 Sources, Systems and Changes capability map', async () => {
    process.env.LIBRO_SERVICE_URL = 'https://libro.memorioso.xyz'
    const response = GET(new Request('https://memorioso.xyz/.well-known/openship.json'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')

    const discovery = await response.json()
    expect(discovery).toMatchObject({
      openship: '1.0',
      capability: 'discovery',
      project: { name: 'Memorioso' },
      agent: {
        summary: expect.any(String),
        instructions: expect.stringContaining('Fetch and read agent.skill'),
        skill: 'https://memorioso.xyz/openship/file/skills/openship/SKILL.md',
      },
      page: 'https://memorioso.xyz/openship',
      capabilities: {
        sources: {
          description: expect.any(String),
          manifest: 'https://memorioso.xyz/openship/manifest.json',
          bundle: 'https://memorioso.xyz/openship/bundle.json',
          mcp: 'https://libro.memorioso.xyz/mcp',
        },
        changes: {
          description: expect.any(String),
          policy: 'https://memorioso.xyz/openship/policy.json',
          submit: 'https://memorioso.xyz/openship/changes',
          status: 'https://memorioso.xyz/openship/changes/{changeId}',
        },
      },
    })
    expect(discovery.capabilities.systems.document).toBe('https://memorioso.xyz/openship/systems.json')
    expect(discovery.manifest).toBeUndefined()
    expect(discovery.changes).toBeUndefined()
  })

  it('omits the optional MCP binding when Libro is not configured', async () => {
    const discovery = await GET(new Request('https://memorioso.xyz/.well-known/openship.json')).json()
    expect(discovery.capabilities.sources.mcp).toBeUndefined()
  })
})
