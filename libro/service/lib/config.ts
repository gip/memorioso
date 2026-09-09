import { parseLibroAuthorReference } from '@libro/core'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
export const WRITE_GRANT_MAX_AGE_SECONDS = 24 * 60 * 60
export const RP_CONTEXT_TTL_SECONDS = 5 * 60

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function serviceOrigin(): string {
  const url = new URL(required('LIBRO_SERVICE_URL'))
  return url.origin
}

export function browserUrl(path: string): string {
  return new URL(`/libro${path}`, new URL(required('NEXT_PUBLIC_APP_URL')).origin).toString()
}

export function mcpResource(): string {
  return new URL('/mcp', serviceOrigin()).toString()
}

export function defaultAuthorNamespace(): string {
  return parseLibroAuthorReference({ namespace: serviceOrigin(), id: 'configuration-check' }).namespace
}

export function worldIdConfig() {
  return {
    appId: required('NEXT_PUBLIC_WORLD_ID_APP_ID') as `app_${string}`,
    rpId: required('WORLD_ID_RP_ID') as `rp_${string}`,
    signingKeyHex: required('WORLD_ID_RP_SIGNING_KEY'),
    environment: process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging'
      ? 'staging' as const
      : 'production' as const,
  }
}

export function writesEnabled(): boolean {
  return process.env.LIBRO_SERVICE_WRITES_ENABLED === '1'
}

export function webhookSecret(): string {
  return required('LIBRO_WEBHOOK_SECRET')
}

export function mcpStateSecret(): string {
  const value = required('LIBRO_MCP_STATE_SECRET')
  if (Buffer.byteLength(value) < 32) throw new Error('LIBRO_MCP_STATE_SECRET must be at least 32 bytes')
  return value
}

export function signingCapabilitySecret(): string {
  const value = required('LIBRO_SIGNING_CAPABILITY_SECRET')
  if (Buffer.byteLength(value) < 32) throw new Error('LIBRO_SIGNING_CAPABILITY_SECRET must be at least 32 bytes')
  return value
}
