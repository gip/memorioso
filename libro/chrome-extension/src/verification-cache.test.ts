import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LibroChainUnavailableError,
  LibroNotRegisteredError,
  actionHashToHex,
  canonicalPublicationSignal,
  hashPublicationSignal,
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
    world_id_action: 'written-by-a-human-v4-cache-test',
    world_id_credential_policy: 'orb' as const,
    author_id_libro: 'author-1',
    publication_date: '2026-07-21T12:00:00.000Z',
    author_name_libro: 'Ada',
    author_handle_libro: 'ada',
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
      action_hash: actionHashToHex(publication.world_id_action),
      transaction_hash: transactionHash as `0x${string}`,
    },
  }
}

const LABEL = 'worldchain-mainnet.gateway.tenderly.co'

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
    const first = createCachedChainVerifier(['https://rpc.example'], verify)

    await expect(first(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    // A fresh verifier proves the hit came from storage rather than the in-flight map.
    const second = createCachedChainVerifier(['https://rpc.example'], verify)
    await expect(second(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('returns the caller manifest on a hit rather than anything it stored', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    await createCachedChainVerifier(['https://rpc.example'], verify)(value)

    const live = manifest()
    const result = await createCachedChainVerifier(['https://rpc.example'], verify)(live)
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

    await expect(createCachedChainVerifier(['https://rpc.example'], verify)(value))
      .rejects.toBeInstanceOf(LibroNotRegisteredError)
    await expect(createCachedChainVerifier(['https://rpc.example'], verify)(value))
      .rejects.toThrow('No endpoint has this signal')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('never caches an unreachable chain, so connectivity returning is enough to recover', async () => {
    const value = manifest()
    const verify = vi.fn()
      .mockRejectedValueOnce(new LibroChainUnavailableError('World Chain could not be reached', []))
      .mockResolvedValueOnce(verification(value))
    const verifier = createCachedChainVerifier(['https://rpc.example'], verify)

    await expect(verifier(value)).rejects.toBeInstanceOf(LibroChainUnavailableError)
    await expect(verifier(value)).resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('collapses concurrent verification of the same manifest into one chain query', async () => {
    const value = manifest()
    const verify = vi.fn(async () => verification(value))
    const verifier = createCachedChainVerifier(['https://rpc.example'], verify)

    const results = await Promise.all([verifier(value), verifier(value), verifier(value)])
    expect(results).toHaveLength(3)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keys on the cited transaction, so the same signal through another transaction is re-checked', async () => {
    const first = manifest()
    const second = manifest(`0x${'22'.repeat(32)}`)
    expect(libroVerificationCacheKey(first)).not.toBe(libroVerificationCacheKey(second))

    const verify = vi.fn(async (value: LibroEmbedManifestV1) => verification(value))
    const verifier = createCachedChainVerifier(['https://rpc.example'], verify)
    await verifier(first)
    await verifier(second)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('ignores entries that have expired and discards malformed ones', async () => {
    const value = manifest()
    store[VERIFICATION_CACHE_KEY] = {
      [libroVerificationCacheKey(value)]: {
        status: 'verified',
        outcomes: [],
        verifiedBy: ['stale-endpoint'],
        expiresAt: Date.now() - 1,
      },
      'junk-key': 'not an entry',
    }
    const verify = vi.fn(async () => verification(value))

    await expect(createCachedChainVerifier(['https://rpc.example'], verify)(value))
      .resolves.toMatchObject({ verifiedBy: [LABEL] })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(store[VERIFICATION_CACHE_KEY]).not.toHaveProperty('junk-key')
  })

  it('clears everything it stored', async () => {
    const value = manifest()
    await createCachedChainVerifier(['https://rpc.example'], async () => verification(value))(value)
    expect(store[VERIFICATION_CACHE_KEY]).toBeDefined()

    await clearLibroVerificationCache()
    expect(store[VERIFICATION_CACHE_KEY]).toBeUndefined()
  })
})
