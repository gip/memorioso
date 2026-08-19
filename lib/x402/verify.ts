import { getAddress, isAddress, isHex, type Address } from 'viem'
import { createLibroPublicClient } from '@libro/core'
import { LIBRO_WORLD_CHAIN_ID } from '@/lib/libro/contract'
import { getLibroServerConfig } from '@/lib/libro/config'
import {
  X402_ACCEPTED_NETWORKS,
  X402_SCHEME,
  X402_VERSION,
  getPublicationAccessConfig,
} from '@/lib/access/config'
import { eip3009Abi, TRANSFER_WITH_AUTHORIZATION_TYPES, transferAuthorizationDomain } from './eip3009'
import type { PaymentPayload, PaymentRequirements } from './types'

/** Leaves the relayer enough room to land the settlement before the authorization expires. */
const SETTLEMENT_SLACK_SECONDS = BigInt(6)

export type VerificationResult =
  | { ok: true; payer: Address; amount: bigint; validBefore: bigint }
  | { ok: false; reason: string }

export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' ? (parsed as PaymentPayload) : null
  } catch {
    return null
  }
}

function parseUint(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a base-10 unsigned integer string`)
  }
  return BigInt(value)
}

export async function verifyPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<VerificationResult> {
  const fail = (reason: string): VerificationResult => ({ ok: false, reason })

  if (payload.x402Version !== X402_VERSION) return fail('Unsupported x402Version')
  if (payload.scheme !== X402_SCHEME) return fail(`Unsupported scheme, expected "${X402_SCHEME}"`)
  if (!X402_ACCEPTED_NETWORKS.includes(payload.network)) {
    return fail(`Unsupported network, expected "${requirements.network}"`)
  }

  const exact = payload.payload
  const authorization = exact?.authorization
  if (!authorization || !isHex(exact.signature)) return fail('Malformed exact payload')
  if (!isAddress(authorization.from) || !isAddress(authorization.to)) {
    return fail('Authorization addresses are malformed')
  }
  if (!isHex(authorization.nonce) || authorization.nonce.length !== 66) {
    return fail('Authorization nonce must be a 32-byte hex string')
  }
  if (getAddress(authorization.to) !== getAddress(requirements.payTo)) {
    return fail('Authorization pays the wrong recipient')
  }

  let value: bigint
  let validAfter: bigint
  let validBefore: bigint
  try {
    value = parseUint(authorization.value, 'value')
    validAfter = parseUint(authorization.validAfter, 'validAfter')
    validBefore = parseUint(authorization.validBefore, 'validBefore')
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Malformed authorization')
  }

  if (value < BigInt(requirements.maxAmountRequired)) {
    return fail(`Authorization pays ${value}, needs ${requirements.maxAmountRequired}`)
  }

  const now = BigInt(Math.floor(Date.now() / 1000))
  if (validAfter > now) return fail('Authorization is not valid yet')
  if (validBefore <= now + SETTLEMENT_SLACK_SECONDS) return fail('Authorization has expired')

  const config = getPublicationAccessConfig()
  const client = createLibroPublicClient(getLibroServerConfig().rpcUrls)
  const payer = getAddress(authorization.from)

  const domain = transferAuthorizationDomain({
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId: LIBRO_WORLD_CHAIN_ID,
    asset: config.asset,
  })

  // Passing the client lets ERC-1271 smart-contract wallets pay too.
  const signatureValid = await client.verifyTypedData({
    address: payer,
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: payer,
      to: getAddress(authorization.to),
      value,
      validAfter,
      validBefore,
      nonce: authorization.nonce,
    },
    signature: exact.signature,
  }).catch(() => false)

  if (!signatureValid) return fail('Authorization signature is invalid')

  const [onChainUsed, balance] = await Promise.all([
    client.readContract({
      address: config.asset,
      abi: eip3009Abi,
      functionName: 'authorizationState',
      args: [payer, authorization.nonce],
    }),
    client.readContract({
      address: config.asset,
      abi: eip3009Abi,
      functionName: 'balanceOf',
      args: [payer],
    }),
  ])

  if (onChainUsed) return fail('Authorization nonce has already been used on chain')
  if (balance < value) return fail('Payer balance is below the authorized amount')

  return { ok: true, payer, amount: value, validBefore }
}
