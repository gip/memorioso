import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForUserOperation } from './wallet-receipt'
describe('wallet receipt polling', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('waits through 202 before returning a confirmed hash', async () => {
    vi.useFakeTimers()
    const hash=`0x${'1'.repeat(64)}`
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({pending:true},{status:202})).mockResolvedValueOnce(Response.json({transactionHash:hash}))
    vi.stubGlobal('fetch',fetcher)
    const result=waitForUserOperation(hash)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBe(hash)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({pending:true})))
    await expect(waitForUserOperation('hash')).rejects.toThrow('invalid transaction hash')
  })
})
