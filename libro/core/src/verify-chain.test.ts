import { describe, expect, it, vi } from 'vitest'
import { keccak256, toBytes, toHex, TransactionReceiptNotFoundError } from 'viem'

type EndpointBehaviour = {
  chainId?: number
  registered?: boolean
  receipt?: 'match' | 'wrong-signal' | 'reverted' | 'missing'
  finalizedBlock?: bigint
  failWith?: string
}

const behaviours = new Map<string, EndpointBehaviour>()
const queried: string[] = []

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    http: (url: string) => ({ __url: url }),
    createPublicClient: ({ transport }: { transport: { __url: string } }) => {
      const url = transport.__url
      const behaviour = () => behaviours.get(url) ?? {}
      return {
        async getChainId() {
          const { chainId = 480, failWith } = behaviour()
          if (failWith) throw new Error(failWith)
          return chainId
        },
        async readContract() {
          queried.push(url)
          const { failWith, registered = true } = behaviour()
          if (failWith) throw new Error(failWith)
          return registered
        },
        async getTransactionReceipt({ hash }: { hash: string }) {
          const { receipt = 'match' } = behaviour()
          if (receipt === 'missing') throw new actual.TransactionReceiptNotFoundError({ hash: hash as `0x${string}` })
          return {
            status: receipt === 'reverted' ? 'reverted' : 'success',
            blockNumber: 32887703n,
            logs: [{
              address: REGISTRY,
              topics: [
                TOPIC0,
                receipt === 'wrong-signal' ? toHex(1n, { size: 32 }) : toHex(BigInt(SIGNAL_HASH), { size: 32 }),
                toHex(BigInt(ACTION_HASH), { size: 32 }),
              ],
              data: '0x',
            }],
          }
        },
        async getBlock() {
          const { finalizedBlock = 32887703n, failWith } = behaviour()
          if (failWith) throw new Error(failWith)
          return { number: finalizedBlock }
        },
      }
    },
  }
})

const {
  LibroNotRegisteredError,
  LibroRegistrationMismatchError,
  LibroRegistrationPendingFinalityError,
  LibroRegistrationUnconfirmedError,
  LibroChainUnavailableError,
  actionHashToHex,
  canonicalPublicationSignal,
  hashPublicationSignal,
  libroRpcLabel,
  parseLibroRpcUrls,
  verifyLibroManifestOnChain,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  LIBRO_WORLD_CHAIN_RPC_URLS,
} = await import('./index')

const REGISTRY = LIBRO_V1_REGISTRY_ADDRESS
const TOPIC0 = keccak256(toBytes('SignalRegistered(uint256,uint256)'))
const publication = {
  publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
  libro_protocol_version: LIBRO_PROTOCOL_VERSION,
  world_id_protocol_version: '4.0' as const,
  world_id_action: 'written-by-a-human-v4-chain-test',
  world_id_credential_policy: 'orb' as const,
  author_id_libro: 'author-1',
  publication_date: '2026-07-27T00:10:31.296Z',
  author_name_libro: 'Ada',
  author_handle_libro: 'ada',
  author_bio_libro: '',
  publication_title: '',
  publication_content: { html: '<p>Hello human world.</p>' },
  publication_subtitle: '',
}
const SIGNAL_HASH = hashPublicationSignal(canonicalPublicationSignal(publication))
const ACTION_HASH = actionHashToHex(publication.world_id_action)

function manifest() {
  return {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: LIBRO_HUMAN_SIGNED_CLAIM,
    publication,
    registration: {
      chain_id: 480 as const,
      registry_address: REGISTRY,
      signal_hash: SIGNAL_HASH,
      action_hash: ACTION_HASH,
      transaction_hash: `0x${'11'.repeat(32)}` as `0x${string}`,
    },
  }
}

const FRESH = 'https://fresh.example'
const PRUNED = 'https://pruned.example'

function configure(entries: Record<string, EndpointBehaviour>): string[] {
  behaviours.clear()
  queried.length = 0
  Object.entries(entries).forEach(([url, behaviour]) => behaviours.set(url, behaviour))
  return Object.keys(entries)
}

describe('Libro RPC configuration', () => {
  it('reads a comma-separated list and falls back to the built-in endpoints', () => {
    expect(parseLibroRpcUrls('https://a.example, https://b.example')).toEqual(['https://a.example', 'https://b.example'])
    expect(parseLibroRpcUrls('')).toEqual([...LIBRO_WORLD_CHAIN_RPC_URLS])
    expect(parseLibroRpcUrls(undefined)).toEqual([...LIBRO_WORLD_CHAIN_RPC_URLS])
    expect(parseLibroRpcUrls(['https://a.example'])).toEqual(['https://a.example'])
  })

  it('labels endpoints by host', () => {
    expect(libroRpcLabel('https://worldchain-mainnet.gateway.tenderly.co')).toBe('worldchain-mainnet.gateway.tenderly.co')
    expect(libroRpcLabel('not a url')).toBe('not a url')
  })

  it('keeps the pruning default last so it cannot decide a verdict alone', () => {
    expect(LIBRO_WORLD_CHAIN_RPC_URLS[0]).toContain('tenderly')
    expect(LIBRO_WORLD_CHAIN_RPC_URLS.at(-1)).toContain('alchemy')
  })
})

describe('Libro on-chain verification across endpoints', () => {
  it('verifies when one endpoint has the transaction and another has pruned it', async () => {
    const urls = configure({ [PRUNED]: { receipt: 'missing' }, [FRESH]: { receipt: 'match' } })
    const verification = await verifyLibroManifestOnChain(manifest(), urls)

    expect(verification.verifiedBy).toEqual(['fresh.example'])
    expect(verification.outcomes.map((outcome) => outcome.status).sort()).toEqual(['unconfirmed', 'verified'])
    // Both endpoints are asked, so a pruned one cannot shadow a healthy one.
    expect(queried.sort()).toEqual([FRESH, PRUNED].sort())
  })

  it('reports unconfirmed only when every endpoint lacks the transaction', async () => {
    const urls = configure({ [PRUNED]: { receipt: 'missing' }, [FRESH]: { receipt: 'missing' } })
    await expect(verifyLibroManifestOnChain(manifest(), urls)).rejects.toBeInstanceOf(LibroRegistrationUnconfirmedError)
    await expect(verifyLibroManifestOnChain(manifest(), urls)).rejects.toMatchObject({
      outcomes: [{ status: 'unconfirmed' }, { status: 'unconfirmed' }],
    })
  })

  it('still verifies when an endpoint is unreachable', async () => {
    const urls = configure({ [PRUNED]: { failWith: 'HTTP request failed: 429' }, [FRESH]: { receipt: 'match' } })
    const verification = await verifyLibroManifestOnChain(manifest(), urls)
    expect(verification.verifiedBy).toEqual(['fresh.example'])
  })

  it('reports a matching receipt as pending until its block is finalized', async () => {
    const urls = configure({ [FRESH]: { receipt: 'match', finalizedBlock: 32887702n } })
    await expect(verifyLibroManifestOnChain(manifest(), urls))
      .rejects.toBeInstanceOf(LibroRegistrationPendingFinalityError)
    await expect(verifyLibroManifestOnChain(manifest(), urls)).rejects.toMatchObject({
      outcomes: [{ status: 'pending_finality' }],
    })
  })

  it('rejects an endpoint that serves a different chain', async () => {
    const urls = configure({ [FRESH]: { chainId: 1 } })
    await expect(verifyLibroManifestOnChain(manifest(), urls))
      .rejects.toBeInstanceOf(LibroRegistrationMismatchError)
    await expect(verifyLibroManifestOnChain(manifest(), urls)).rejects.toMatchObject({
      outcomes: [{ status: 'mismatch', detail: expect.stringContaining('chain id 1') }],
    })
  })

  it('ranks a contradiction above an absence', async () => {
    const urls = configure({ [FRESH]: { receipt: 'wrong-signal' }, [PRUNED]: { receipt: 'missing' } })
    await expect(verifyLibroManifestOnChain(manifest(), urls)).rejects.toBeInstanceOf(LibroRegistrationMismatchError)

    const reverted = configure({ [FRESH]: { receipt: 'reverted' } })
    await expect(verifyLibroManifestOnChain(manifest(), reverted)).rejects.toBeInstanceOf(LibroRegistrationMismatchError)
  })

  it('reports an unregistered signal and a total outage differently', async () => {
    const absent = configure({ [FRESH]: { registered: false }, [PRUNED]: { registered: false } })
    await expect(verifyLibroManifestOnChain(manifest(), absent)).rejects.toBeInstanceOf(LibroNotRegisteredError)

    const offline = configure({ [FRESH]: { failWith: 'offline' }, [PRUNED]: { failWith: 'offline' } })
    await expect(verifyLibroManifestOnChain(manifest(), offline)).rejects.toBeInstanceOf(LibroChainUnavailableError)
  })
})
