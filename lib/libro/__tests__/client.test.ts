import { beforeEach, describe, expect, it, vi } from 'vitest'

const miniKitMock = vi.hoisted(() => ({
  install: vi.fn(),
  isInstalled: vi.fn(),
  sendTransaction: vi.fn(),
}))

vi.mock('@worldcoin/minikit-js', () => ({
  MiniKit: miniKitMock,
}))

import {
  isNativeLibroTransactionAvailable,
  sendLibroRegistrationTransaction,
} from '../client'
import type { LibroRegistrationTransaction } from '../proof'

const transaction: LibroRegistrationTransaction = {
  chainId: 480,
  transactions: [{
    to: '0x1111111111111111111111111111111111111111' as const,
    data: '0x1234' as const,
    value: '0x0' as const,
  }],
}

function worldAppWindow() {
  return {
    WorldApp: {
      supported_commands: [{ name: 'send-transaction', supported_versions: [1] }],
    },
  }
}

describe('Libro MiniKit transactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('window', worldAppWindow())
    miniKitMock.install.mockReturnValue({ success: true })
    miniKitMock.isInstalled.mockReturnValue(true)
    miniKitMock.sendTransaction.mockResolvedValue({
      executedWith: 'minikit',
      data: { userOpHash: '0xabc' },
    })
  })

  it('reports native transaction availability inside a compatible World App', () => {
    expect(isNativeLibroTransactionAvailable()).toBe(true)
  })

  it('uses the native World wallet transaction command', async () => {
    await expect(sendLibroRegistrationTransaction(transaction)).resolves.toEqual({
      userOpHash: '0xabc',
    })
    expect(miniKitMock.sendTransaction).toHaveBeenCalledWith(transaction)
  })

  it('rejects non-MiniKit transaction execution', async () => {
    miniKitMock.sendTransaction.mockResolvedValue({
      executedWith: 'fallback',
      data: {},
    })

    await expect(sendLibroRegistrationTransaction(transaction)).rejects.toThrow(
      'Publication registration must be authorized by the World wallet inside World App.'
    )
  })

  it('reports unavailable when the send-transaction command is missing', () => {
    vi.stubGlobal('window', { WorldApp: { supported_commands: [] } })

    expect(isNativeLibroTransactionAvailable()).toBe(false)
  })
})
