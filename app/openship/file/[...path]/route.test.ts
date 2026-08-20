import { describe, expect, it } from 'vitest'
import { GET, generateStaticParams } from './route'

const request = new Request('https://memorioso.xyz/openship/file/x')
const call = (segments: string[]) => GET(request, { params: Promise.resolve({ path: segments }) })

describe('GET /openship/file/[...path]', () => {
  it('serves a tracked file as readable text', async () => {
    const response = await call(['package.json'])
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(JSON.parse(await response.text()).name).toBe('memorioso')
  })

  it('serves a nested path', async () => {
    const response = await call(['lib', 'libro', 'agent.ts'])
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('import')
  })

  it('serves binary assets with their real media type', async () => {
    const response = await call(['public', 'logo.png'])
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })

  // Traversal is not filtered, it is unrepresentable: the path is looked up as a manifest key and
  // never resolved against a filesystem.
  it.each([
    [['..', '..', '.env.local']],
    [['%2e%2e', '.env.local']],
    [['.env.local']],
    [['node_modules', 'next', 'package.json']],
    [['does', 'not', 'exist.ts']],
  ])('returns 404 for %j', async segments => {
    const response = await call(segments)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('not_found')
  })

  it('prerenders every manifest file', () => {
    const params = generateStaticParams()
    expect(params.length).toBeGreaterThan(100)
    expect(params).toContainEqual({ path: ['package.json'] })
    expect(params).toContainEqual({ path: ['lib', 'libro', 'agent.ts'] })
  })
})
