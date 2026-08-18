import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LibroChainUnavailableError,
  LibroNotRegisteredError,
  LibroRegistrationPendingFinalityError,
  canonicalPublicationSignal,
  hashPublicationSignal,
  hashLibroHandle,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  type LibroChainVerification,
  type LibroEmbedManifestV1,
} from '@libro/core'
import {
  VERIFICATION_CACHE_KEY,
  clearLibroVerificationCache,
  createCachedChainVerifier,
  libroVerificationCacheKey,
} from './verification-cache'

let store: Record<string, unknown> = {}

beforeEach(() => {
  store = {}
  vi.useRealTimers()
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (values: Record<string, unknown>) => { Object.assign(store, values) },
          remove: async (key: string) => { delete store[key] },
        },
      },
    },
  })
})

function manifest(transactionHash = `0x${'11'.repeat(32)}`): LibroEmbedManifestV1 {
  const publication = {
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_protocol_version: '4.0' as const,
    world_id_proof_type: 'session' as const,
    world_id_credential_policy: 'orb' as const,
    author_id_libro: 'author-1',
    publication_date: '2026-07-21T12:00:00.000Z',
    author_name_libro: 'Ada',
    author_handle_libro: 'ada',
    author_handle_hash_libro: hashLibroHandle('ada'),
    author_bio_libro: '',
    publication_title: '',
    publication_content: { html: '<p>Hello world.</p>' },
    publication_subtitle: '',
  }
  return {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: LIBRO_HUMAN_SIGNED_CLAIM,
    publication,
    registration: {
      chain_id: 480,
      registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication)),
      handle_hash: publication.author_handle_hash_libro,
      authorship_class: 'human',
      transaction_hash: transactionHash as `0x${string}`,
    },
  }
}

const LABEL = 'worldchain-mainnet.gateway.tenderly.co'
const RPC_URLS = ['https://rpc.example']

function verification(value: LibroEmbedManifestV1): LibroChainVerification {
  return {
    manifest: value,
    outcomes: [{ rpcUrl: `https://${LABEL}`, label: LABEL, status: 'verified', detail: 'Registered in block 1' }],
    verifiedBy: [LABEL],
  }
}

describe('libro verification cache', () => {
  it('queries the chain once and serves the confirmation from storage after that', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    const first = createCachedChainVerifier(RPC_URLS, verify)

    await expect(first(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    // A fresh verifier proves the hit came from storage rather than the in-flight map.
    const second = createCachedChainVerifier(RPC_URLS, verify)
    await expect(second(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('returns the caller manifest on a hit rather than anything it stored', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    await createCachedChainVerifier(RPC_URLS, verify)(value)

    const live = manifest()
    const result = await createCachedChainVerifier(RPC_URLS, verify)(live)
    expect(result.manifest).toBe(live)
    expect(JSON.stringify(store[VERIFICATION_CACHE_KEY])).not.toContain('publication_content')
  })

  it('holds a missing registration briefly and replays it as the same error', async () => {
    const value = manifest()
    const verify = vi.fn(async () => {
      throw new LibroNotRegisteredError('No endpoint has this signal', [
        { rpcUrl: `https://${LABEL}`, label: LABEL, status: 'not_registered', detail: 'No SignalRegistered event' },
      ])
    })

    await expect(createCachedChainVerifier(RPC_URLS, verify)(value))
      .rejects.toBeInstanceOf(LibroNotRegisteredError)
    await expect(createCachedChainVerifier(RPC_URLS, verify)(value))
      .rejects.toThrow('No endpoint has this signal')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('never caches an unreachable chain, so connectivity returning is enough to recover', async () => {
    const value = manifest()
    const verify = vi.fn()
      .mockRejectedValueOnce(new LibroChainUnavailableError('World Chain could not be reached', []))
      .mockResolvedValueOnce(verification(value))
    const verifier = createCachedChainVerifier(RPC_URLS, verify)

    await expect(verifier(value)).rejects.toBeInstanceOf(LibroChainUnavailableError)
    await expect(verifier(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('never caches a mined registration before it reaches finality', async () => {
    const value = manifest()
    const verify = vi.fn()
      .mockRejectedValueOnce(new LibroRegistrationPendingFinalityError('Pending finality', []))
      .mockResolvedValueOnce(verification(value))
    const verifier = createCachedChainVerifier(RPC_URLS, verify)

    await expect(verifier(value)).rejects.toBeInstanceOf(LibroRegistrationPendingFinalityError)
    await expect(verifier(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent verification of the same manifest into one chain query', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    const verifier = createCachedChainVerifier(RPC_URLS, verify)

    const results = await Promise.all([verifier(value), verifier(value), verifier(value)])
    expect(results).toHaveLength(3)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keys on the cited transaction, so the same signal through another transaction is re-checked', async () => {
    const first = manifest()
    const second = manifest(`0x${'22'.repeat(32)}`)
    expect(libroVerificationCacheKey(first, RPC_URLS)).not.toBe(libroVerificationCacheKey(second, RPC_URLS))

    const verify = vi.fn(async (value: LibroEmbedManifestV1) => verification(value))
    const verifier = createCachedChainVerifier(RPC_URLS, verify)
    await verifier(first)
    await verifier(second)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a confirmation after the trusted endpoint set changes', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    await createCachedChainVerifier(['https://first.example'], verify)(value)
    await createCachedChainVerifier(['https://second.example'], verify)(value)
    expect(verify).toHaveBeenCalledTimes(2)
    expect(libroVerificationCacheKey(value, ['https://first.example']))
      .not.toBe(libroVerificationCacheKey(value, ['https://second.example']))
  })

  it('ignores entries that have expired and discards malformed ones', async () => {
    const value = manifest()
    store[VERIFICATION_CACHE_KEY] = {
      [libroVerificationCacheKey(value, RPC_URLS)]: {
        status: 'verified',
        outcomes: [],
        verifiedBy: ['stale-endpoint'],
        expiresAt: Date.now() - 1,
      },
      'junk-key': 'not an entry',
    }
    const verify = vi.fn(async () => verification(value))

    await expect(createCachedChainVerifier(RPC_URLS, verify)(value))
      .resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(store[VERIFICATION_CACHE_KEY]).not.toHaveProperty('junk-key')
  })

  it('clears everything it stored', async () => {
    const value = manifest()
    await createCachedChainVerifier(RPC_URLS, async () => verification(value))(value)
    expect(store[VERIFICATION_CACHE_KEY]).toBeDefined()

    await clearLibroVerificationCache()
    expect(store[VERIFICATION_CACHE_KEY]).toBeUndefined()
  })
})
