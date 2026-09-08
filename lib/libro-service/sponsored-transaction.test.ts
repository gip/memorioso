import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniKit } from '@worldcoin/minikit-js'
import { CommandUnavailableError, Command } from '@worldcoin/minikit-js/commands'
import { sendSponsoredWorldTransaction } from './sponsored-transaction'

vi.mock('@worldcoin/minikit-js', () => ({ MiniKit: { isInstalled: vi.fn(), sendTransaction: vi.fn() } }))
const transaction = { chainId: 480, transactions: [{ to: '0x1', data: '0x2', value: '0x0' }] }

describe('automatic gas sponsorship', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('uses Libro outside World App without opening a wallet', async () => {
    vi.mocked(MiniKit.isInstalled).mockReturnValue(false)
    expect(await sendSponsoredWorldTransaction(transaction)).toBeNull()
    expect(MiniKit.sendTransaction).not.toHaveBeenCalled()
  })
  it('uses the sponsored World operation inside the mini app', async () => {
    vi.mocked(MiniKit.isInstalled).mockReturnValue(true)
    vi.mocked(MiniKit.sendTransaction).mockResolvedValue({ executedWith: 'minikit', data: {
      userOpHash: '0xabc', status: 'success', version: 2, from: '0x1', timestamp: '',
    } })
    expect(await sendSponsoredWorldTransaction(transaction)).toBe('0xabc')
  })
  it('uses Libro when the native command is unavailable', async () => {
    vi.mocked(MiniKit.isInstalled).mockReturnValue(true)
    vi.mocked(MiniKit.sendTransaction).mockRejectedValue(new CommandUnavailableError(Command.SendTransaction, 'oldAppVersion'))
    expect(await sendSponsoredWorldTransaction(transaction)).toBeNull()
  })
  it.each(['daily_tx_limit_reached', 'invalid_contract'])('uses Libro for %s', async (code) => {
    vi.mocked(MiniKit.isInstalled).mockReturnValue(true)
    vi.mocked(MiniKit.sendTransaction).mockRejectedValue(Object.assign(new Error(code), { code }))
    expect(await sendSponsoredWorldTransaction(transaction)).toBeNull()
  })
  it.each(['user_rejected', 'generic_error', 'transaction_failed'])('does not resubmit after %s', async (code) => {
    vi.mocked(MiniKit.isInstalled).mockReturnValue(true)
    const error = Object.assign(new Error(code), { code })
    vi.mocked(MiniKit.sendTransaction).mockRejectedValue(error)
    await expect(sendSponsoredWorldTransaction(transaction)).rejects.toBe(error)
  })
})
