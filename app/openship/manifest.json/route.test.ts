import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /openship/manifest.json', () => {
  it('describes the project and every file', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')

    const manifest = await response.json()
    expect(manifest.openship).toBe('1.0')
    expect(manifest.project.name).toBe('Memorioso')
    expect(manifest.stack.length).toBeGreaterThan(0)
    expect(manifest.structure.length).toBeGreaterThan(0)
    expect(manifest.totals.files).toBe(manifest.files.length)
    expect(manifest.files.some((file: { path: string }) => file.path === 'README.md')).toBe(true)
  })

  it('publishes env var names but never values', async () => {
    const manifest = await GET().json()
    expect(manifest.env).toContain('SESSION_SECRET')
    expect(JSON.stringify(manifest)).not.toContain('replace-with-a-generated-secret')
  })

  it('computes the digest as specified in OPENSHIP.md', async () => {
    const manifest = await GET().json()
    const expected =
      'sha256:' +
      createHash('sha256')
        .update(
          manifest.files
            .map((file: { path: string; sha256: string }) => `${file.path}\0${file.sha256}\n`)
            .join('')
        )
        .digest('hex')
    expect(manifest.digest).toBe(expected)
  })
})
