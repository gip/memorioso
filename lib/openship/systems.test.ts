import { describe, expect, it } from 'vitest'
import { computeSourcesDigest, validateSystems } from '@openship/protocol'
import { createHash } from 'node:crypto'
import { GET } from '@/app/openship/systems.json/route'
import { getOpenshipManifest, getOpenshipBundleJson } from './manifest'
import { composeOpenshipSystems } from './systems.mjs'
import { openshipViewerUrl } from '@/components/Openship/ViewerLink'

const snapshot = () => ({ manifest: structuredClone(getOpenshipManifest()), bundle: JSON.parse(getOpenshipBundleJson()) })

// Re-sign the Sources envelope after changing the model so graph/context validation is exercised.
const changedModel = (change: (model: ReturnType<typeof JSON.parse>) => void) => {
  const { manifest, bundle } = snapshot()
  const path = 'lib/openship/system.json'
  const model = JSON.parse(bundle.files[path].content)
  change(model)
  const content = JSON.stringify(model)
  bundle.files[path].content = content
  const file = manifest.files.find(file => file.path === path)!
  file.size = Buffer.byteLength(content)
  file.sha256 = createHash('sha256').update(content).digest('hex')
  manifest.totals.bytes = manifest.files.reduce((sum, file) => sum + file.size, 0)
  manifest.digest = bundle.digest = computeSourcesDigest(manifest.files)
  return { manifest, bundle }
}

describe('OpenShip Systems provider', () => {
  it('serves a conformant public document embedding the exact standalone Sources', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    const document = await response.json()
    expect(() => validateSystems(document)).not.toThrow()
    expect(document.source.manifest).toEqual(getOpenshipManifest())
    expect(document.source.bundle).toEqual(JSON.parse(getOpenshipBundleJson()))
    expect(document.source.manifest.files.map((file: { path: string }) => file.path)).not.toContain('public/openship/systems.json')
  })

  it.each([
    ['invalid edge', (model: ReturnType<typeof JSON.parse>) => { model.layers[0].edges[0].toNodeId = 'missing' }],
    ['unmatched source selector', (model: ReturnType<typeof JSON.parse>) => { model.layers[0].nodes[0].sourceSelectors = ['missing/**'] }],
    ['corrupted document hash', (model: ReturnType<typeof JSON.parse>) => { model.context.documents[0].text += ' changed' }],
    ['unresolved context reference', (model: ReturnType<typeof JSON.parse>) => { model.context.matrix[0].documentRefs = [`sha256:${'0'.repeat(64)}`] }],
  ])('rejects %s during composition', (_name, change) => {
    const { manifest, bundle } = changedModel(change)
    expect(() => composeOpenshipSystems(manifest, bundle)).toThrow()
  })

  it('rejects corrupted embedded sources and a missing model', () => {
    const { manifest, bundle } = snapshot()
    bundle.files['lib/openship/system.json'].content += ' '
    expect(() => composeOpenshipSystems(manifest, bundle)).toThrow()
    delete bundle.files['lib/openship/system.json']
    expect(() => composeOpenshipSystems(manifest, bundle)).toThrow(/Missing/)
  })

  it('preserves storage, relayer, cutover and sandbox boundaries in the model', async () => {
    const { system } = await GET().json()
    const nodes = new Map(system.layers.find((layer: { role: string }) => layer.role === 'technical').nodes.map((node: { id: string; parentId?: string }) => [node.id, node.parentId]))
    expect(nodes.get('p.app-db')).not.toEqual(nodes.get('p.libro-db'))
    expect(nodes.get('p.build')).toBe('c.sandbox')
    expect(nodes.get('p.worker')).toBe('h.build')
    const prose = JSON.stringify(system)
    for (const invariant of ['LIBRO_SERVICE_READS_ENABLED', 'LIBRO_SERVICE_WRITES_ENABLED', 'X402_RELAYER_PRIVATE_KEY', 'LIBRO_RELAYER_PRIVATE_KEY', 'non-extractable', 'not content confidentiality', 'no production secrets', 'separate registrable domain']) {
      expect(prose).toContain(invariant)
    }
  })

  it('links to the supplied deployment origin without paths or secrets', () => {
    const url = new URL(openshipViewerUrl('https://abc123.builds.example/openship'))
    expect(url.origin).toBe('https://openship.dev')
    expect(url.searchParams.get('url')).toBe('https://abc123.builds.example')
    expect(url.searchParams.get('view')).toBe('system')
    expect(url.searchParams.get('panel')).toBe('architecture')
  })
})

it('publishes three mapped layers and an unresolved Vercel/Neon production target', async () => {
  const document = await GET().json()
  expect(document.systemsVersion).toBe('2.0')
  const { layers, instances, refinements } = document.system
  expect(layers.map((layer: { role: string }) => layer.role)).toEqual(['logical', 'technical', 'provider'])
  const provider = layers[2]
  const app = provider.nodes.find((node: { id: string }) => node.id === 'provider.h.memorioso')
  const libro = provider.nodes.find((node: { id: string }) => node.id === 'provider.h.libro')
  expect(app.metadata.provider).toBe('Vercel')
  expect(libro.metadata.provider).toBe('Vercel')
  const stores = provider.nodes.filter((node: { kind: string }) => node.kind === 'Store')
  expect(stores).toHaveLength(2)
  expect(new Set(stores.map((node: { parentId: string }) => node.parentId)).size).toBe(2)
  expect(stores.every((node: { name: string }) => node.name.includes('Neon'))).toBe(true)
  expect(instances[0].id).toBe('production')
  expect(instances[0].bindings.every((binding: { resourceId?: string; state?: unknown }) => binding.resourceId === undefined && binding.state === undefined)).toBe(true)
  expect(refinements.some((ref: { fromNodeId: string; toNodeId: string }) => ref.fromNodeId === 'provider.p.app-db' && ref.toNodeId === 'p.app-db')).toBe(true)
  const schemaArtifacts = document.system.context.artifacts.filter((artifact: { nodeId: string }) => artifact.nodeId === 'p.app-db' || artifact.nodeId === 'p.libro-db')
  expect(schemaArtifacts).toHaveLength(2)
  expect(schemaArtifacts.every((artifact: { sourcePaths: string[] }) => artifact.sourcePaths.some(path => path.endsWith('/schema.sql')))).toBe(true)
})

it('never copies runtime credentials into the public Systems document', () => {
  const keys = ['DATABASE_URL', 'SESSION_SECRET', 'VERCEL_TOKEN', 'LIBRO_RELAYER_PRIVATE_KEY']
  const previous = keys.map(key => process.env[key])
  const sentinel = ['private', 'runtime', Date.now(), Math.random()].join('-')
  try {
    for (const key of keys) process.env[key] = sentinel
    const { manifest, bundle } = snapshot()
    const serialized = JSON.stringify(composeOpenshipSystems(manifest, bundle))
    expect(serialized).not.toContain(sentinel)
    expect(serialized).toContain('secretRef')
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]
    })
  }
})

it('declares overlapping domains across design layers with valid members', async () => {
  const { system } = await GET().json()
  const domains = system.domains as { id: string; name: string; nodeIds: string[] }[]
  expect(domains.map(domain => domain.name)).toEqual(['Memorioso Web', 'Libro MCP', 'Chain', 'Memorioso Chrome Extension'])
  const nodes = new Set(system.layers.flatMap((layer: { nodes: { id: string }[] }) => layer.nodes.map(node => node.id)))
  for (const domain of domains) {
    expect(new Set(domain.nodeIds).size).toBe(domain.nodeIds.length)
    expect(domain.nodeIds.every(id => nodes.has(id))).toBe(true)
    expect(domain.nodeIds.some(id => id.startsWith('logical.'))).toBe(true)
    expect(domain.nodeIds.some(id => id.startsWith('provider.'))).toBe(true)
  }
  expect(domains.filter(domain => domain.nodeIds.includes('l.libro'))).toHaveLength(4)
  expect(domains.find(domain => domain.id === 'memorioso-chrome-extension')?.nodeIds).toContain('p.extension')
  expect(domains.find(domain => domain.id === 'libro-mcp')?.nodeIds).toContain('p.libro-db')
})
