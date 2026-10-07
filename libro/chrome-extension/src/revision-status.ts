import { readLibroRevisionStatus, configuredLibroRegistries, type LibroPublicationReference } from '@libro/core'
export const REVISION_STATUS_TTL_MS = 15_000
const cache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof readLibroRevisionStatus>> }>()
export async function revisionStatus(reference: LibroPublicationReference, rpcUrls?: readonly string[], read = readLibroRevisionStatus) {
  const key = `${configuredLibroRegistries().v2}:${reference.registry_address}:${reference.signal_hash}:${rpcUrls?.join(',')}`
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const value = await read(reference, rpcUrls)
  if (cache.size >= 500) cache.delete(cache.keys().next().value!)
  cache.set(key, { value, expiresAt: Date.now() + REVISION_STATUS_TTL_MS })
  return value
}
