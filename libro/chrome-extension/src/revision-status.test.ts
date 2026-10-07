import { describe, it, expect, vi, afterEach } from 'vitest'
import { revisionStatus, REVISION_STATUS_TTL_MS } from './revision-status'
const reference = { chain_id:480 as const, registry_address:'0x1111111111111111111111111111111111111111' as const, signal_hash:`0x${'12'.repeat(32)}` as `0x${string}` }
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
describe('mutable revision status cache', () => {
  it('refreshes after a short TTL independently of immutable registration verification', async () => {
    vi.useFakeTimers()
    vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS','0x2222222222222222222222222222222222222222')
    const read = vi.fn().mockResolvedValueOnce({exists:true,isLatest:true}).mockResolvedValueOnce({exists:true,isLatest:false})
    expect(await revisionStatus(reference,[],read)).toMatchObject({isLatest:true})
    expect(await revisionStatus(reference,[],read)).toMatchObject({isLatest:true})
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(REVISION_STATUS_TTL_MS + 1)
    expect(await revisionStatus(reference,[],read)).toMatchObject({isLatest:false})
    expect(read).toHaveBeenCalledTimes(2)
  })
})
