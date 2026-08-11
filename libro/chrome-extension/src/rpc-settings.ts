import { LIBRO_WORLD_CHAIN_RPC_URLS, libroRpcLabel } from '@libro/core'

export const RPC_SETTINGS_KEY = 'libro:rpc-endpoints'

export type LibroRpcEndpoint = {
  url: string
  enabled: boolean
}

export function defaultLibroRpcEndpoints(): LibroRpcEndpoint[] {
  return LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => ({ url, enabled: true }))
}

export function isDefaultLibroRpcUrl(url: string): boolean {
  return LIBRO_WORLD_CHAIN_RPC_URLS.some((candidate) => candidate === url)
}

export function libroRpcHost(url: string): string {
  return libroRpcLabel(url)
}

/** Only https endpoints: an extension talking to plain http would be a downgrade the page cannot see. */
export function normalizeLibroRpcUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Enter an RPC URL')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('That is not a valid URL')
  }
  if (parsed.protocol !== 'https:') throw new Error('RPC URLs must use https')
  return parsed.toString().replace(/\/$/, '')
}

/** Host permission pattern an added endpoint needs before the service worker may call it. */
export function libroRpcOriginPattern(url: string): string {
  return `${new URL(url).origin}/*`
}

function isEndpoint(value: unknown): value is LibroRpcEndpoint {
  return typeof value === 'object' && value !== null &&
    typeof (value as LibroRpcEndpoint).url === 'string' &&
    typeof (value as LibroRpcEndpoint).enabled === 'boolean'
}

/**
 * Stored settings are authoritative for what is enabled, but built-in endpoints are always
 * present so a shipped addition reaches existing installs and a default cannot be lost — those
 * can be switched off, only custom endpoints can be removed.
 */
export async function loadLibroRpcEndpoints(): Promise<LibroRpcEndpoint[]> {
  const stored = await chrome.storage.sync.get(RPC_SETTINGS_KEY)
  const saved = stored[RPC_SETTINGS_KEY]
  const endpoints = Array.isArray(saved) ? saved.filter(isEndpoint) : []
  const seen = new Set(endpoints.map((endpoint) => endpoint.url))
  const missingDefaults = defaultLibroRpcEndpoints().filter((endpoint) => !seen.has(endpoint.url))
  return [...endpoints, ...missingDefaults]
}

export async function saveLibroRpcEndpoints(endpoints: LibroRpcEndpoint[]): Promise<void> {
  await chrome.storage.sync.set({ [RPC_SETTINGS_KEY]: endpoints })
}

/**
 * Endpoints verification should query. Disabling everything would silently stop verification, so
 * an empty selection falls back to the built-in list rather than reporting every block unknown.
 */
export async function enabledLibroRpcUrls(): Promise<string[]> {
  const endpoints = await loadLibroRpcEndpoints()
  const enabled = endpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => endpoint.url)
  return enabled.length > 0 ? enabled : [...LIBRO_WORLD_CHAIN_RPC_URLS]
}
