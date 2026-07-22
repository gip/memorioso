import { actionHashToHex as coreActionHashToHex } from '@libro/core'
import { isHex, type Hex } from 'viem'

export const MAX_UINT64 = BigInt('18446744073709551615')
export const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1)

export function normalizeHex(value: string, fieldName: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed hex string`)
  }

  return value.toLowerCase() as Hex
}

export function hexToUint256(value: string, fieldName: string): bigint {
  return BigInt(normalizeHex(value, fieldName))
}

export function parseUint256(value: string, fieldName: string): bigint {
  const parsed = isHex(value)
    ? BigInt(value)
    : /^\d+$/.test(value)
      ? BigInt(value)
      : null

  if (parsed === null) {
    throw new Error(`${fieldName} must be a decimal uint256 or 0x-prefixed hex string`)
  }

  if (parsed < BigInt(0) || parsed > MAX_UINT256) {
    throw new Error(`${fieldName} must be between 0 and ${MAX_UINT256.toString()}`)
  }

  return parsed
}

export function parseUint64(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a decimal uint64`)
  }

  const parsed = BigInt(value)
  if (parsed <= BigInt(0) || parsed > MAX_UINT64) {
    throw new Error(`${fieldName} must be between 1 and ${MAX_UINT64.toString()}`)
  }

  return parsed
}

export function rpIdToUint64(rpId: string): bigint {
  const match = /^rp_([0-9a-fA-F]{16})$/.exec(rpId)
  if (!match) {
    throw new Error('WORLD_ID_RP_ID must be in rp_<16 hex chars> format')
  }

  return BigInt(`0x${match[1]}`)
}

export function actionHashToHex(action: string): Hex {
  return coreActionHashToHex(action)
}

export function actionHashToUint256(action: string): bigint {
  return BigInt(actionHashToHex(action))
}
