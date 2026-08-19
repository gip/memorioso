import {
  X402_MAX_TIMEOUT_SECONDS,
  X402_NETWORK,
  X402_SCHEME,
  X402_VERSION,
  getPublicationAccessConfig,
  priceToAssetUnits,
} from '@/lib/access/config'
import type { PaymentRequirements, PaymentRequiredBody } from './types'

export function buildPaymentRequirements({
  resource,
  description,
  priceUsd,
}: {
  resource: string
  description: string
  priceUsd: string
}): PaymentRequirements {
  const config = getPublicationAccessConfig()

  return {
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    maxAmountRequired: priceToAssetUnits(priceUsd).toString(),
    resource,
    description,
    mimeType: 'application/json',
    payTo: config.payTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    asset: config.asset,
    // The payer needs the asset's EIP-712 domain to sign a valid authorization.
    extra: { name: config.assetName, version: config.assetVersion },
  }
}

export function paymentRequiredBody(
  requirements: PaymentRequirements,
  error: string
): PaymentRequiredBody {
  return { x402Version: X402_VERSION, error, accepts: [requirements] }
}

export function encodeSettlementHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}
