import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeSourcesDigest, type SourceFileMetadata } from '@openship/protocol'
import { ServiceError } from './errors'
import {
  MAX_OPENSHIP_SOURCE_BYTES,
  getOpenShipSnapshot,
  readOpenShipFile,
  resetOpenShipSnapshotCacheForTests,
} from './openship'

type Source = ReturnType<typeof makeSource>

function makeSource(files: Record<string, string>) {
  const entries = Object.entries(files).sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)))
  const metadata: SourceFileMetadata[] = entries.map(([path, content]) => ({
    path,
    size: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    encoding: 'utf-8',
    mediaType: 'text/plain; charset=utf-8',
    type: 'file',
  }))
  const digest = computeSourcesDigest(metadata)
  const manifest = {
    openship: '1.0' as const,
    capability: 'sources' as const,
    digest,
    project: { name: 'Memorioso', description: 'A test source.' },
    totals: { files: metadata.length, bytes: metadata.reduce((sum, file) => sum + file.size, 0) },
    files: metadata,
  }
  const bundle = {
    openship: '1.0' as const,
    capability: 'sources' as const,
    digest,
    files: Object.fromEntries(entries.map(([path, content]) => [path, { encoding: 'utf-8', content }])),
  }
  return { manifest, bundle }
}

function discovery() {
  return {
    openship: '1.0',
    capability: 'discovery',
    project: { name: 'Memorioso', description: 'A test source.' },
    agent: {
      summary: 'OpenShip lets this running project publish verifiable source code.',
      instructions: 'Fetch and read agent.skill before interpreting any advertised capability.',
      skill: 'https://memorioso.test/openship/file/skills/openship/SKILL.md',
    },
    page: 'https://memorioso.test/openship',
    capabilities: {
      sources: {
        description: 'Retrieve and verify the exact source snapshot published by this deployment.',
        manifest: 'https://memorioso.test/openship/manifest.json',
        bundle: 'https://memorioso.test/openship/bundle.json',
      },
    },
  }
}

function installFetch(source: Source) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openship.json')) return Response.json(discovery())
    if (url.endsWith('/manifest.json')) return Response.json(source.manifest)
    if (url.endsWith('/bundle.json')) return Response.json(source.bundle)
    return new Response(null, { status: 404 })
  })
}

describe('Libro OpenShip source loader', () => {
  beforeEach(() => {
    process.env.OPENSHIP_SOURCE_ORIGIN = 'https://memorioso.test'
    resetOpenShipSnapshotCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENSHIP_SOURCE_ORIGIN
  })

  it('validates the snapshot and reuses its bundle while the digest is unchanged', async () => {
    const fetchMock = installFetch(makeSource({ 'README.md': '# Memorioso\n', 'app/page.tsx': 'export default 1\n' }))

    const first = await getOpenShipSnapshot()
    expect(first.manifest.files).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const second = await readOpenShipFile('app/page.tsx')
    expect(second.content).toBe('export default 1\n')
    expect(second.snapshot.manifest.digest).toBe(first.manifest.digest)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('refreshes every verified byte when the manifest digest changes', async () => {
    const first = makeSource({ 'app/page.tsx': 'old\n' })
    const second = makeSource({ 'app/page.tsx': 'new\n' })
    let current = first
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openship.json')) return Response.json(discovery())
      if (url.endsWith('/manifest.json')) return Response.json(current.manifest)
      if (url.endsWith('/bundle.json')) return Response.json(current.bundle)
      return new Response(null, { status: 404 })
    })

    expect((await readOpenShipFile('app/page.tsx')).content).toBe('old\n')
    current = second
    expect((await readOpenShipFile('app/page.tsx')).content).toBe('new\n')
  })

  it('returns machine-readable path and integrity failures without source content', async () => {
    const source = makeSource({ 'app/page.tsx': 'secret marker\n' })
    source.bundle.files['app/page.tsx'].content = 'tampered\n'
    installFetch(source)

    await expect(readOpenShipFile('../.env')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
    try {
      await getOpenShipSnapshot()
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError)
      expect((error as Error).message).not.toContain('secret marker')
    }
  })

  it('rejects file size and manifest total mismatches', async () => {
    const source = makeSource({ 'app/page.tsx': 'content\n' })
    source.manifest.files[0].size += 1
    source.manifest.totals.bytes += 1
    source.manifest.digest = computeSourcesDigest(source.manifest.files)
    source.bundle.digest = source.manifest.digest
    installFetch(source)

    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('rejects undeclared paths after loading a valid snapshot', async () => {
    installFetch(makeSource({ 'app/page.tsx': 'export default 1\n' }))
    await expect(readOpenShipFile('app/missing.tsx')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('does not serve the cached snapshot when a changed deployment is invalid', async () => {
    const first = makeSource({ 'app/page.tsx': 'old\n' })
    const second = makeSource({ 'app/page.tsx': 'new\n' })
    let current = first
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/openship.json')) return Response.json(discovery())
      if (url.endsWith('/manifest.json')) return Response.json(current.manifest)
      if (url.endsWith('/bundle.json')) return Response.json(current.bundle)
      return new Response(null, { status: 404 })
    })

    expect((await readOpenShipFile('app/page.tsx')).content).toBe('old\n')
    current = second
    current.bundle.digest = first.bundle.digest

    await expect(readOpenShipFile('app/page.tsx')).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('maps upstream failures without returning cached source content', async () => {
    const source = makeSource({ 'app/page.tsx': 'cached\n' })
    const fetchMock = installFetch(source)
    expect((await readOpenShipFile('app/page.tsx')).content).toBe('cached\n')

    fetchMock.mockRejectedValue(new Error('upstream unavailable'))
    await expect(readOpenShipFile('app/page.tsx')).rejects.toMatchObject({
      code: 'OPENSHIP_UNAVAILABLE',
    })
  })

  it('rejects a decoded snapshot larger than the MCP limit', async () => {
    const source = makeSource({ 'large.txt': 'x'.repeat(MAX_OPENSHIP_SOURCE_BYTES + 1) })
    installFetch(source)
    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
  })

  it('requires a configured source origin', async () => {
    delete process.env.OPENSHIP_SOURCE_ORIGIN
    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'OPENSHIP_UNAVAILABLE' })
  })
})
