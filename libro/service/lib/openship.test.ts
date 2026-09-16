import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeSourcesDigest, validateSkills, validateSystems, type SourceFileMetadata } from '@openship/protocol'
import mcpModel from './openship-system.json'
import fullSystem from '../../../lib/openship/system.json'
import { ServiceError } from './errors'
import {
  MAX_OPENSHIP_SOURCE_BYTES,
  getOpenShipSnapshot,
  readOpenShipFile,
  readOpenShipDocument,
  resetOpenShipSnapshotCacheForTests,
} from './openship'

const embedded = vi.hoisted(() => ({ manifest: vi.fn(), bundle: vi.fn() }))
vi.mock('../../../lib/openship/manifest', () => ({
  getOpenshipManifest: embedded.manifest,
  getOpenshipBundleJson: embedded.bundle,
}))

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
    project: { name: 'Memorioso', productDescription: 'Test publishing.', productSummary: '# Product\n\nTest publication.', technicalDescription: 'Test source.', technicalSummary: '# Implementation\n\nTest deployment.' },
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

function installSnapshot(source: Source) {
  embedded.manifest.mockReturnValue(source.manifest)
  embedded.bundle.mockImplementation(() => JSON.stringify(source.bundle))
}

describe('Libro OpenShip source loader', () => {
  beforeEach(() => {
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('OPENSHIP_SOURCE_ORIGIN', '')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network unavailable'))
    embedded.manifest.mockReset()
    embedded.bundle.mockReset()
    resetOpenShipSnapshotCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('validates local bytes once and serves repeated and concurrent reads without network access', async () => {
    installSnapshot(makeSource({ 'README.md': '# Memorioso\n', 'app/page.tsx': 'export default 1\n' }))

    const first = await getOpenShipSnapshot()
    expect(first.manifest.files).toHaveLength(2)
    expect(embedded.bundle).toHaveBeenCalledTimes(1)

    const second = await readOpenShipFile('app/page.tsx')
    expect(second.content).toBe('export default 1\n')
    expect(second.snapshot.manifest.digest).toBe(first.manifest.digest)
    expect(embedded.bundle).toHaveBeenCalledTimes(1)
    const snapshots = await Promise.all([getOpenShipSnapshot(), getOpenShipSnapshot()])
    expect(snapshots[0]).toBe(first)
    expect(snapshots[1]).toBe(first)
    expect(first.origin).toBe('https://libro.test')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('serves standalone MCP discovery, verified bundle, and skill', async () => {
    const source = makeSource({ 'skills/openship/SKILL.md': '# OpenShip' })
    installSnapshot(source)
    expect(await readOpenShipDocument('bundle')).toEqual(source.bundle)
    expect(await readOpenShipDocument('skill')).toBe('# OpenShip')
    expect(await readOpenShipDocument('discovery')).toMatchObject({
      mcpBinding: '1.0',
      agent: { skill: { operation: 'document', kind: 'skill' } },
      capabilities: { sources: {
        manifest: { operation: 'manifest' },
        bundle: { operation: 'document', kind: 'bundle' },
      } },
    })
    await expect(readOpenShipDocument('policy')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(readOpenShipDocument('systems')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('shares the complete Libro skill from verified bytes without extra catalog requests', async () => {
    const paths = ['SKILL.md', 'references/mcp.md', 'references/protocol.md', 'references/embed.md']
    const files = Object.fromEntries(paths.map(path => [
      `libro/skill/${path}`, readFileSync(new URL(`../../skill/${path}`, import.meta.url), 'utf8'),
    ]))
    installSnapshot(makeSource(files))
    const catalog = validateSkills(await readOpenShipDocument('skills'))
    expect(catalog.skills).toHaveLength(1)
    expect(Object.keys(catalog.skills[0].files).sort()).toEqual(paths.sort())
    for (const path of paths) expect(catalog.skills[0].files[path].content).toBe(files[`libro/skill/${path}`])
    expect(await readOpenShipDocument('discovery')).toMatchObject({
      capabilities: { skills: { document: { operation: 'document', kind: 'skills' } } },
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('omits Skills for older snapshots and rejects incomplete portable folders', async () => {
    installSnapshot(makeSource({ 'README.md': '# Old snapshot' }))
    expect(await readOpenShipDocument('discovery')).not.toHaveProperty('capabilities.skills')
    await expect(readOpenShipDocument('skills')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    resetOpenShipSnapshotCacheForTests()
    installSnapshot(makeSource({ 'libro/skill/SKILL.md': '# Incomplete' }))
    await expect(readOpenShipDocument('skills')).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('describes only Libro MCP while retaining the complete verified repository snapshot', async () => {
    const source = makeSource({
      'libro/service/lib/openship-system.json': JSON.stringify(mcpModel),
      'libro/service/app/mcp/route.ts': '// MCP endpoint',
      'libro/service/db/schema.sql': '-- canonical store',
      'libro/core/src/index.ts': '// shared protocol',
      'libro/contracts/src/LibroRegistry.sol': '// registry',
      ...Object.fromEntries(mcpModel.system.context.artifacts.flatMap(artifact =>
        artifact.sourcePaths.map(path => [path, '// schema source']))),
      'app/page.tsx': '// website outside MCP scope',
    })
    installSnapshot(source)
    validateSystems({ openship: '1.0', capability: 'systems', systemsVersion: '2.0',
      source: { manifest: source.manifest, bundle: source.bundle }, system: mcpModel.system })
    const document = await readOpenShipDocument('systems')
    expect(document).toMatchObject({
      system: mcpModel.system,
      source: { manifest: source.manifest, bundle: source.bundle },
    })
    expect(await readOpenShipDocument('discovery')).toMatchObject({
      project: mcpModel.project,
      agent: { summary: expect.stringContaining('Libro MCP') },
      capabilities: {
        systems: { document: { operation: 'document', kind: 'systems' } },
        sources: { description: expect.stringContaining('outside the Libro MCP system boundary') },
      },
    })
    expect(JSON.stringify(mcpModel)).not.toMatch(/memorioso/i)
    expect(JSON.stringify(await readOpenShipDocument('discovery'))).not.toMatch(/memorioso/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('keeps Libro components and relationships as a subset of the shared system', () => {
    const rootIds = new Set(mcpModel.system.layers.map(layer => layer.rootNodeId))
    for (const layer of mcpModel.system.layers) {
      const shared = fullSystem.layers.find(candidate => candidate.id === layer.id)!
      for (const node of layer.nodes) {
        if (rootIds.has(node.id)) continue
        const original = shared.nodes.find(candidate => candidate.id === node.id)!
        expect(original).toBeDefined()
        expect(node).toEqual({ ...original, parentId: original.parentId === shared.rootNodeId ? layer.rootNodeId : original.parentId })
      }
      for (const edge of layer.edges) expect(shared.edges).toContainEqual(edge)
    }
    for (const refinement of mcpModel.system.refinements) expect(fullSystem.refinements).toContainEqual(refinement)
    for (const layer of mcpModel.system.layers.filter(layer => layer.role !== 'logical')) {
      expect(layer.nodes.find(node => node.name === 'Libro MCP' && node.kind === 'Process')).toMatchObject({
        metadata: { mcpEndpoint: 'https://libro-mcp.vercel.app/mcp' },
      })
    }
  })

  it('rejects an invalid MCP model in an otherwise verified snapshot', async () => {
    installSnapshot(makeSource({ 'libro/service/lib/openship-system.json': '{' }))
    await expect(readOpenShipDocument('systems')).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('rejects a skill absent from the verified snapshot', async () => {
    installSnapshot(makeSource({ 'README.md': '# Source' }))
    await expect(readOpenShipDocument('skill')).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('keeps deployment bytes until a new process loads a new snapshot', async () => {
    installSnapshot(makeSource({ 'app/page.tsx': 'old' }))
    expect((await readOpenShipFile('app/page.tsx')).content).toBe('old')
    installSnapshot(makeSource({ 'app/page.tsx': 'new' }))
    expect((await readOpenShipFile('app/page.tsx')).content).toBe('old')
    resetOpenShipSnapshotCacheForTests()
    expect((await readOpenShipFile('app/page.tsx')).content).toBe('new')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns machine-readable path and integrity failures without source content', async () => {
    const source = makeSource({ 'app/page.tsx': 'secret marker\n' })
    source.bundle.files['app/page.tsx'].content = 'tampered\n'
    installSnapshot(source)

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
    installSnapshot(source)

    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'OPENSHIP_INVALID' })
  })

  it('rejects undeclared paths after loading a valid snapshot', async () => {
    installSnapshot(makeSource({ 'app/page.tsx': 'export default 1\n' }))
    await expect(readOpenShipFile('app/missing.tsx')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a decoded snapshot larger than the MCP limit', async () => {
    const source = makeSource({ 'large.txt': 'x'.repeat(MAX_OPENSHIP_SOURCE_BYTES + 1) })
    installSnapshot(source)
    await expect(getOpenShipSnapshot()).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
  })

})
