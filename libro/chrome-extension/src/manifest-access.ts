export const MANIFEST_ORIGINS_KEY = 'libro:manifest-origins'

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map((part) => Number(part))
  return numbers.every((part, index) => Number.isInteger(part) && part >= 0 && part <= 255 && String(part) === parts[index])
    ? numbers
    : null
}

export function isPrivateNetworkHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true

  const ipv4 = parseIpv4(hostname)
  if (ipv4) {
    const [first, second] = ipv4
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
  }

  if (!hostname.includes(':')) return false
  if (hostname === '::' || hostname === '::1') return true
  if (/^(?:fc|fd)/i.test(hostname) || /^fe[89a-f]/i.test(hostname) || /^ff/i.test(hostname)) return true
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(hostname)
  if (dotted) return isPrivateNetworkHostname(dotted[1])
  const hexadecimal = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname)
  if (!hexadecimal) return false
  const high = Number.parseInt(hexadecimal[1], 16)
  const low = Number.parseInt(hexadecimal[2], 16)
  return isPrivateNetworkHostname([
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join('.'))
}

export function normalizeManifestOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Enter a manifest origin')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('That is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('Manifest origins must use https')
  if (url.username || url.password) throw new Error('Manifest origins cannot include credentials')
  if (isPrivateNetworkHostname(url.hostname)) {
    throw new Error('Manifest origins cannot target a private or local network')
  }
  return url.origin
}

function isStoredOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return normalizeManifestOrigin(value) === value
  } catch {
    return false
  }
}

export async function loadApprovedManifestOrigins(): Promise<string[]> {
  const stored = await chrome.storage.sync.get(MANIFEST_ORIGINS_KEY)
  const values = stored[MANIFEST_ORIGINS_KEY]
  return Array.isArray(values) ? [...new Set(values.filter(isStoredOrigin))] : []
}

export async function saveApprovedManifestOrigins(origins: string[]): Promise<void> {
  const normalized = [...new Set(origins.map(normalizeManifestOrigin))].sort()
  await chrome.storage.sync.set({ [MANIFEST_ORIGINS_KEY]: normalized })
}

export function manifestOriginPattern(origin: string): string {
  return `${new URL(origin).origin}/*`
}
