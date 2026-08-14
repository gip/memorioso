import {
  LibroNotRegisteredError,
  verifyLibroManifestOnChain,
  type LibroChainVerification,
  type LibroEmbedManifestV1,
  type LibroRpcOutcome,
} from '@libro/core'

export const VERIFICATION_CACHE_KEY = 'libro:verification-cache'

/**
 * A confirmed registration is immutable, so the only reason to expire it is to bound the cache.
 * A missing one is not: the same signal can be registered a minute later, so it is held briefly
 * to stop a page full of unregistered tags from re-querying every endpoint on every visit.
 */
export const VERIFIED_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const NOT_REGISTERED_TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 500

type CacheEntry =
  | { status: 'verified'; outcomes: LibroRpcOutcome[]; verifiedBy: string[]; expiresAt: number }
  | { status: 'not_registered'; outcomes: LibroRpcOutcome[]; detail: string; expiresAt: number }

type ChainVerifier = (manifest: LibroEmbedManifestV1) => Promise<LibroChainVerification>

/**
 * The transaction hash is part of the key: two manifests can cite the same signal through
 * different transactions, and only the cited one is what verification actually confirmed.
 */
export function libroVerificationCacheKey(
  manifest: LibroEmbedManifestV1,
  rpcUrls: readonly string[] = []
): string {
  const { chain_id, registry_address, signal_hash, handle_hash, authorship_class, transaction_hash } = manifest.registration
  const trustConfiguration = rpcUrls.map((value) => {
    try {
      return new URL(value).toString().replace(/\/$/, '')
    } catch {
      return value.trim()
    }
  }).sort().join(',')
  return `${chain_id}:${registry_address}:${signal_hash}:${handle_hash}:${authorship_class}:${transaction_hash}:${trustConfiguration}`.toLowerCase()
}

function isEntry(value: unknown, now: number): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as CacheEntry
  if (entry.status !== 'verified' && entry.status !== 'not_registered') return false
  if (typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) return false
  return Array.isArray(entry.outcomes)
}

async function readCache(now: number): Promise<Record<string, CacheEntry>> {
  const stored = await chrome.storage.local.get(VERIFICATION_CACHE_KEY)
  const raw = stored[VERIFICATION_CACHE_KEY]
  if (typeof raw !== 'object' || raw === null) return {}
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => isEntry(value, now)) as Array<[string, CacheEntry]>
  return Object.fromEntries(entries)
}

// Read-modify-write against one storage key, so concurrent writes are serialized rather than racing.
let writeQueue: Promise<void> = Promise.resolve()

function writeEntry(key: string, entry: CacheEntry): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const now = Date.now()
    const cache = await readCache(now)
    cache[key] = entry
    const keys = Object.keys(cache)
    if (keys.length > MAX_ENTRIES) {
      // Evict the entries closest to expiring, which are the short-lived negatives first.
      const doomed = keys.sort((left, right) => cache[left].expiresAt - cache[right].expiresAt)
        .slice(0, keys.length - MAX_ENTRIES)
      for (const doomedKey of doomed) delete cache[doomedKey]
    }
    await chrome.storage.local.set({ [VERIFICATION_CACHE_KEY]: cache })
  }).catch(() => undefined)
  return writeQueue
}

export async function clearLibroVerificationCache(): Promise<void> {
  await chrome.storage.local.remove(VERIFICATION_CACHE_KEY)
}

/**
 * Wraps on-chain verification with a persistent cache and in-flight de-duplication. Only the chain
 * result is cached: everything else `verifyCandidate` checks is a property of the page in front of
 * the reader, so it must be re-derived from the live DOM on every scan.
 *
 * Endpoint failures are never cached — an unreachable World Chain is a fact about the network at
 * that moment, and caching it would report the page unknown long after connectivity returned.
 */
export function createCachedChainVerifier(
  rpcUrls: string[],
  verify: (
    manifest: LibroEmbedManifestV1,
    urls: string[]
  ) => Promise<LibroChainVerification> = verifyLibroManifestOnChain
): ChainVerifier {
  const inFlight = new Map<string, Promise<LibroChainVerification>>()

  return async function verifyWithCache(manifest: LibroEmbedManifestV1): Promise<LibroChainVerification> {
    const key = libroVerificationCacheKey(manifest, rpcUrls)
    const cache = await readCache(Date.now())
    const cached = cache[key]
    // The stored manifest is never trusted back: the caller's manifest is the one being verified.
    if (cached?.status === 'verified') {
      return { manifest, outcomes: cached.outcomes, verifiedBy: cached.verifiedBy }
    }
    if (cached?.status === 'not_registered') {
      throw new LibroNotRegisteredError(cached.detail, cached.outcomes)
    }

    const existing = inFlight.get(key)
    if (existing) return existing

    const pending = (async () => {
      try {
        const verification = await verify(manifest, rpcUrls)
        await writeEntry(key, {
          status: 'verified',
          outcomes: verification.outcomes,
          verifiedBy: verification.verifiedBy,
          expiresAt: Date.now() + VERIFIED_TTL_MS,
        })
        return verification
      } catch (error) {
        if (error instanceof LibroNotRegisteredError) {
          await writeEntry(key, {
            status: 'not_registered',
            outcomes: error.outcomes,
            detail: error.message,
            expiresAt: Date.now() + NOT_REGISTERED_TTL_MS,
          })
        }
        throw error
      }
    })()

    inFlight.set(key, pending)
    try {
      return await pending
    } finally {
      inFlight.delete(key)
    }
  }
}
