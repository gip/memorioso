import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { candidateSourcesMatch } from '@/lib/openship/candidate'
import { digestOfFiles, publicChangeStatus } from '@/lib/openship/change'
import type { OpenshipFile } from '@/lib/openship/manifest'
import { validateChange } from '@/lib/openship/validate'

describe('OpenShip Changes lifecycle', () => {
  it('binds acceptance and readiness to one predicted resulting Sources digest', () => {
    const content = 'export default () => <p>published</p>\n'
    const base: OpenshipFile[] = [
      {
        path: 'app/page.tsx',
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        encoding: 'utf-8',
        mediaType: 'text/plain; charset=utf-8',
        type: 'file',
      },
    ]
    const publishedDigest = digestOfFiles(base)
    const result = validateChange(
      {
        openship: '1.0',
        capability: 'changes',
        base: publishedDigest,
        title: 'Change the published page',
        intent: 'Exercise the complete digest-bound candidate lifecycle in one test.',
        files: {
          'app/page.tsx': {
            encoding: 'utf-8',
            content: 'export default () => <p>candidate</p>\n',
          },
        },
      },
      {
        base,
        baseDigest: publishedDigest,
        mediaTypeOf: () => 'text/plain; charset=utf-8',
      }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const resultingDigest = result.tree.digest
    expect(resultingDigest).not.toBe(publishedDigest)
    expect(publicChangeStatus('queued').status).toBe('pending')
    expect(
      candidateSourcesMatch(
        { openship: '1.0', capability: 'sources', digest: publishedDigest },
        resultingDigest
      )
    ).toBe(false)
    expect(
      candidateSourcesMatch(
        { openship: '1.0', capability: 'sources', digest: resultingDigest },
        resultingDigest
      )
    ).toBe(true)
    expect(publicChangeStatus('deployed').status).toBe('ready')
  })
})
