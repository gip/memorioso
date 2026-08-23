import { describe, expect, it } from 'vitest'
import { validateDiscovery, validateSources } from '@openshipdev/protocol'
import { GET as getDiscovery } from '@/app/.well-known/openship.json/route'
import { GET as getManifest } from '@/app/openship/manifest.json/route'
import { GET as getBundle } from '@/app/openship/bundle.json/route'

describe('@openshipdev/protocol conformance', () => {
  it('accepts Memorioso discovery and the exact published Sources snapshot', async () => {
    const discovery = await getDiscovery(new Request('https://memorioso.xyz/.well-known/openship.json')).json()
    expect(() => validateDiscovery(discovery)).not.toThrow()
    const manifest = await getManifest().json()
    const bundle = await getBundle().json()
    const verified = validateSources(manifest, bundle)
    expect(verified.manifest.project.name).toBe('Memorioso')
    expect(verified.files.length).toBe(manifest.totals.files)
  })
})
