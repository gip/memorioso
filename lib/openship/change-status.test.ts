import { describe, expect, it } from 'vitest'
import { publicChangeStatus, type OpenshipChangeStatus } from '@/lib/openship/change'

describe('publicChangeStatus', () => {
  it.each([
    ['queued', 'pending'],
    ['building', 'processing'],
    ['reviewing', 'processing'],
    ['deployed', 'ready'],
    ['rejected', 'rejected'],
    ['failed', 'failed'],
  ] as const)('maps internal %s to public %s', (internal, publicStatus) => {
    expect(publicChangeStatus(internal as OpenshipChangeStatus).status).toBe(publicStatus)
  })
})
