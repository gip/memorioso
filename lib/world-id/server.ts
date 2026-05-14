import { signRequest } from '@worldcoin/idkit-core/signing'
import type { RpContext } from '@worldcoin/idkit'
import { DEFAULT_WORLD_ID_PUBLISH_ACTION } from './constants'

export type WorldIdServerConfig = {
  appId: `app_${string}`
  rpId: `rp_${string}`
  publishAction: string
  environment: 'production' | 'staging'
  signingKeyHex: string
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function getWorldIdServerConfig(): WorldIdServerConfig {
  const environment = process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging'
    ? 'staging'
    : 'production'

  return {
    appId: requireEnv('NEXT_PUBLIC_WORLD_ID_APP_ID') as `app_${string}`,
    rpId: requireEnv('WORLD_ID_RP_ID') as `rp_${string}`,
    publishAction: process.env.WORLD_ID_PUBLISH_ACTION || DEFAULT_WORLD_ID_PUBLISH_ACTION,
    environment,
    signingKeyHex: requireEnv('WORLD_ID_RP_SIGNING_KEY'),
  }
}

export function createRpContext(config: WorldIdServerConfig, action?: string): RpContext {
  const signature = signRequest({
    action,
    signingKeyHex: config.signingKeyHex,
    ttl: 5 * 60,
  })

  return {
    rp_id: config.rpId,
    nonce: signature.nonce,
    created_at: signature.createdAt,
    expires_at: signature.expiresAt,
    signature: signature.sig,
  }
}

export async function verifyWorldIdProof(result: unknown, rpId: string): Promise<{ ok: boolean; body: unknown; status: number }> {
  const response = await fetch(`https://developer.worldcoin.org/api/v4/verify/${rpId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = { success: false, message: 'World verifier returned a non-JSON response' }
  }

  return {
    ok: response.ok && typeof body === 'object' && body !== null && 'success' in body && body.success === true,
    body,
    status: response.status,
  }
}
