import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /.well-known/openship.json', () => {
  it('advertises the clean v1 Sources and Changes capability map', async () => {
    const response = GET(new Request('https://memorioso.xyz/.well-known/openship.json'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')

    const discovery = await response.json()
    expect(discovery).toMatchObject({
      openship: '1.0',
      capability: 'discovery',
      project: { name: 'Memorioso' },
      skill: 'https://memorioso.xyz/openship/file/skills/openship/SKILL.md',
      capabilities: {
        sources: {
          manifest: 'https://memorioso.xyz/openship/manifest.json',
          bundle: 'https://memorioso.xyz/openship/bundle.json',
        },
        changes: {
          policy: 'https://memorioso.xyz/openship/policy.json',
          submit: 'https://memorioso.xyz/openship/changes',
          status: 'https://memorioso.xyz/openship/changes/{changeId}',
        },
      },
    })
    expect(discovery.capabilities.systems).toBeUndefined()
    expect(discovery.manifest).toBeUndefined()
    expect(discovery.changes).toBeUndefined()
  })
})
