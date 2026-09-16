import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForUserOperation } from './wallet-receipt'
const mcp = vi.hoisted(() => vi.fn())
vi.mock('./browser-mcp', () => ({ browserMcp: mcp }))
describe('wallet receipt polling', () => {
  afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
  it('waits through a pending tool result before returning a confirmed hash', async () => {
    vi.useFakeTimers()
    const hash=`0x${'1'.repeat(64)}`
    mcp.mockResolvedValueOnce({pending:true}).mockResolvedValueOnce({transactionHash:hash})
    const result=waitForUserOperation(hash)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toBe(hash)
    expect(mcp).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed success responses', async () => {
    mcp.mockResolvedValue({})
    await expect(waitForUserOperation('hash')).rejects.toThrow('invalid transaction hash')
  })
})
