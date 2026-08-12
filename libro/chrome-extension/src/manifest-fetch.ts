import type { LibroCandidate } from './shared'
import { isPrivateNetworkHostname } from './manifest-access'

export const MAX_MANIFEST_BYTES = 1_000_000
export const MANIFEST_FETCH_TIMEOUT_MS = 10_000

type ManifestFetchOptions = {
  apiOrigin: string
  approvedOrigins: readonly string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false
  const mediaType = value.split(';', 1)[0].trim().toLowerCase()
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(mediaType)
}

export function validateManifestUrl(value: string, apiOrigin: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('The text tag manifest URL is invalid')
  }
  const trustedApiOrigin = new URL(apiOrigin).origin
  if (url.origin === trustedApiOrigin) {
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
      throw new Error('The text tag manifest URL must use HTTPS')
    }
    return url
  }
  if (url.protocol !== 'https:') throw new Error('The text tag manifest URL must use HTTPS')
  if (url.username || url.password) throw new Error('The text tag manifest URL cannot include credentials')
  if (isPrivateNetworkHostname(url.hostname)) {
    throw new Error('The text tag manifest URL targets a private or local network')
  }
  return url
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
    throw new Error('The text tag manifest is too large')
  }

  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > MAX_MANIFEST_BYTES) throw new Error('The text tag manifest is too large')
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_MANIFEST_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('The text tag manifest is too large')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

export async function resolveTextManifest(
  candidate: LibroCandidate,
  options: ManifestFetchOptions
): Promise<LibroCandidate> {
  if (candidate.kind !== 'text' || candidate.manifestText || candidate.error || !candidate.manifestUrl) {
    return candidate
  }

  let url: URL
  try {
    url = validateManifestUrl(candidate.manifestUrl, options.apiOrigin)
  } catch (error) {
    return { ...candidate, error: error instanceof Error ? error.message : 'The text tag manifest URL is invalid' }
  }

  const apiOrigin = new URL(options.apiOrigin).origin
  if (url.origin !== apiOrigin && !options.approvedOrigins.includes(url.origin)) {
    return {
      ...candidate,
      error: `Permission is required before Libro can retrieve manifests from ${url.origin}`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? MANIFEST_FETCH_TIMEOUT_MS)
  try {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return { ...candidate, error: `The text tag manifest returned HTTP ${response.status}` }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      return { ...candidate, error: 'The text tag manifest did not return a JSON content type' }
    }
    return { ...candidate, manifestText: await readLimitedBody(response) }
  } catch (error) {
    if (error instanceof Error && error.message === 'The text tag manifest is too large') {
      return { ...candidate, error: error.message }
    }
    if (controller.signal.aborted) return { ...candidate, error: 'The text tag manifest request timed out' }
    return { ...candidate, error: 'The text tag manifest could not be retrieved' }
  } finally {
    clearTimeout(timer)
  }
}
