import { describe, expect, it } from 'vitest'
import { assertRelayTransaction } from '../relay'
import type { LibroServerConfig } from '../config'
import type { LibroRegistrationTransaction } from '../proof'

const config: LibroServerConfig = {
  protocolVersion: 'libro-v1',
  chainId: 480,
  registryAddress: '0x1111111111111111111111111111111111111111',
  rpId: BigInt(1),
  rpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public',
}

const transaction: LibroRegistrationTransaction = {
  chainId: 480,
  transactions: [{
    to: config.registryAddress,
    data: '0x1234',
    value: '0x0',
  }],
}

describe('Libro relayer transaction validation', () => {
  it('accepts the prepared call to the configured registry', () => {
    expect(() => assertRelayTransaction(transaction, config)).not.toThrow()
  })

  it('rejects a call to a different contract', () => {
    expect(() => assertRelayTransaction({
      ...transaction,
      transactions: [{
        ...transaction.transactions[0],
        to: '0x2222222222222222222222222222222222222222',
      }],
    }, config)).toThrow('does not target the configured registry')
  })
})
