import { getAddress, isAddress, type Address, type Hex } from 'viem'

export const X402_VERSION = 1
export const X402_SCHEME = 'exact'
/**
 * World Chain has no entry in the x402 v1 named-network registry, so requirements
 * advertise the CAIP-2 identifier. Payers that guessed the human-readable name are
 * still accepted rather than being handed a 402 they cannot satisfy.
 */
export const X402_NETWORK = 'eip155:480'
export const X402_ACCEPTED_NETWORKS: string[] = [X402_NETWORK, 'world-chain']
/** USDC on World Chain is FiatTokenV2_2: EIP-3009, 6 decimals, EIP-712 version "2". */
export const X402_ASSET_DECIMALS = 6
export const X402_MAX_TIMEOUT_SECONDS = 120

export type PublicationAccessConfig = {
  payTo: Address
  asset: Address
  /** EIP-712 domain of the payment asset, echoed to the payer in `extra`. */
  assetName: string
  assetVersion: string
  defaultPriceUsd: string
}

export type X402RelayerConfig = {
  privateKey: Hex
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function requireAddress(name: string): Address {
  const value = requireEnv(name)
  if (!isAddress(value) || value.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${name} must be a valid non-zero EVM address`)
  }
  return getAddress(value)
}

function requirePriceUsd(name: string): string {
  const value = requireEnv(name)
  if (!/^\d+(\.\d{1,6})?$/.test(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive decimal with at most 6 fractional digits`)
  }
  return value
}

export function getPublicationAccessConfig(): PublicationAccessConfig {
  return {
    payTo: requireAddress('X402_PAY_TO_ADDRESS'),
    asset: requireAddress('X402_ASSET_ADDRESS'),
    assetName: requireEnv('X402_ASSET_NAME'),
    assetVersion: requireEnv('X402_ASSET_VERSION'),
    defaultPriceUsd: requirePriceUsd('X402_DEFAULT_PRICE_USD'),
  }
}

let warnedUnconfigured = false

/**
 * x402 is opt-in per deployment: a gated publication in a deployment without the
 * payment env is sign-in only, not broken. Readers of such a publication must still
 * get the wall instead of a server error, so callers on a read path use this and
 * treat `null` as "no payment offer to advertise".
 */
export function tryGetPublicationAccessConfig(): PublicationAccessConfig | null {
  try {
    return getPublicationAccessConfig()
  } catch (error) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      console.warn(
        `x402 payments are unavailable, gated publications are sign-in only: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    return null
  }
}

/**
 * Deliberately not LIBRO_RELAYER_PRIVATE_KEY. Two independent senders on one EOA race
 * on the account nonce, and the settlement is the side that costs a payer money.
 */
export function getX402RelayerConfig(): X402RelayerConfig {
  const privateKey = requireEnv('X402_RELAYER_PRIVATE_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('X402_RELAYER_PRIVATE_KEY must be a 32-byte hex private key')
  }
  return { privateKey: privateKey as Hex }
}

/** USD string to the asset's smallest unit, without floating point rounding. */
export function priceToAssetUnits(priceUsd: string, decimals: number = X402_ASSET_DECIMALS): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(priceUsd.trim())
  if (!match) {
    throw new Error(`Invalid price "${priceUsd}"`)
  }

  const fraction = (match[2] || '').slice(0, decimals).padEnd(decimals, '0')
  return BigInt(`${match[1]}${fraction}`)
}
