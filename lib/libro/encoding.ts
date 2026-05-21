import { keccak256, toBytes, isHex, type Hex } from 'viem'

export const MAX_UINT64 = BigInt('18446744073709551615')

export function normalizeHex(value: string, fieldName: string): Hex {
  if (!isHex(value)) {
    throw new Error(`${fieldName} must be a 0x-prefixed hex string`)
  }

  return value.toLowerCase() as Hex
}

export function hexToUint256(value: string, fieldName: string): bigint {
  return BigInt(normalizeHex(value, fieldName))
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

export function actionHashToHex(action: string): Hex {
  if (!action.trim()) {
    throw new Error('World ID action is required')
  }

  return keccak256(toBytes(action))
}

export function actionHashToUint256(action: string): bigint {
  return BigInt(actionHashToHex(action))
}
