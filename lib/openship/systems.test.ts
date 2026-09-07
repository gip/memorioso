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
    ['invalid edge', (model: ReturnType<typeof JSON.parse>) => { model.edges[0].toNodeId = 'missing' }],
    ['unmatched source selector', (model: ReturnType<typeof JSON.parse>) => { model.nodes[0].sourceSelectors = ['missing/**'] }],
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
    const nodes = new Map(system.nodes.map((node: { id: string; parentId?: string }) => [node.id, node.parentId]))
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
