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

  it('reports the source of its file set and omits the manifest from it', async () => {
    const manifest = await GET().json()
    expect(manifest.fileSet).toBe('manifest')
    // openship.json describes the tree and is not part of it, so it is neither published nor
    // hashed. Publishing it would make the digest a function of a description of the source.
    expect(manifest.files.map((file: { path: string }) => file.path)).not.toContain('openship.json')
  })

  it('carries the ignore lists a retrieved copy needs to verify itself', async () => {
    const manifest = await GET().json()
    // A client saves this document as its openship.json; without these, `pnpm openship:check`
    // would flag node_modules/ and every build artefact as an undeclared file.
    expect(manifest.ignore).toContain('.next/**')
    expect(manifest.ignoreNames).toContain('node_modules')
  })

  it('omits commit rather than sending it empty when there is no git checkout', async () => {
    const manifest = await GET().json()
    // This build has git, so `commit` is present. What the spec forbids is the other case being
    // represented as empty strings, so assert the member is either absent or fully populated.
    if ('commit' in manifest) expect(manifest.commit.sha).toMatch(/^[0-9a-f]{40}$/)
    else expect(manifest.commit).toBeUndefined()
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
