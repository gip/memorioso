import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), config: vi.fn() }))

vi.mock('@/lib/db/openship-changes', () => ({ getOpenshipChange: mocks.get }))
vi.mock('@/lib/openship/changes-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/openship/changes-config')>()),
  getChangesConfig: mocks.config,
}))

import { GET } from './route'

const changeId = '11111111-2222-3333-4444-555555555555'
const call = () =>
  GET(new Request(`https://memorioso.xyz/openship/changes/${changeId}`), {
    params: Promise.resolve({ changeId }),
  })

describe('GET /openship/changes/[changeId]', () => {
  it('reports ready only with the resulting digest and candidate origin', async () => {
    mocks.config.mockReturnValue({ buildsDomain: 'memorioso-builds.xyz' })
    mocks.get.mockResolvedValue({
      changeId,
      buildId: '0123456789ab',
      base: `sha256:${'0'.repeat(64)}`,
      digest: `sha256:${'1'.repeat(64)}`,
      title: 'A verified candidate',
      status: 'deployed',
      reason: null,
      url: 'https://0123456789ab.memorioso-builds.xyz',
      filesChanged: 1,
      submittedAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:01:00.000Z',
    })

    const response = await call()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      openship: '1.0',
      capability: 'changes',
      changeId,
      status: 'ready',
      phase: 'deployed',
      digest: `sha256:${'1'.repeat(64)}`,
      candidateOrigin: 'https://0123456789ab.memorioso-builds.xyz',
      statusUrl: `https://memorioso.xyz/openship/changes/${changeId}`,
    })
  })
})
