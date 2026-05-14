import type { IDKitResult, IDKitResultSession, ResponseItemSession, ResponseItemV4 } from '@worldcoin/idkit'
import { WORLD_ID_ALLOWED_CREDENTIALS } from './constants'

export type WorldIdV4UniquenessResult = Extract<IDKitResult, { protocol_version: '4.0'; action: string }>

export type WorldIdProofContext = {
  action: string
  nonce: string
  environment: 'production' | 'staging'
  signalHash: string
}

export type WorldIdSessionContext = {
  nonce: string
  environment: 'production' | 'staging'
}

export function isV4UniquenessResult(result: IDKitResult | undefined): result is WorldIdV4UniquenessResult {
  return Boolean(
    result &&
    result.protocol_version === '4.0' &&
    'action' in result &&
    !('session_id' in result)
  )
}

export function validateCredentialResponses(responses: ResponseItemV4[] | undefined, signalHash: string): string[] {
  if (!responses || responses.length === 0) {
    throw new Error('World ID result does not contain a credential response')
  }

  const allowed = new Set<string>(WORLD_ID_ALLOWED_CREDENTIALS)
  const normalizedSignalHash = signalHash.toLowerCase()

  return responses.map((response) => {
    if (!allowed.has(response.identifier)) {
      throw new Error(`Unsupported World ID credential: ${response.identifier}`)
    }

    if (!response.signal_hash || response.signal_hash.toLowerCase() !== normalizedSignalHash) {
      throw new Error('World ID signal hash does not match the publication payload')
    }

    if (!Array.isArray(response.proof)) {
      throw new Error('World ID result is not a v4 proof response')
    }

    return response.identifier
  })
}

export function validateWorldIdV4Result(result: IDKitResult | undefined, context: WorldIdProofContext): WorldIdV4UniquenessResult {
  if (!isV4UniquenessResult(result)) {
    throw new Error('World ID 4.0 proof is required')
  }

  if (
    result.action !== context.action ||
    result.nonce !== context.nonce ||
    result.environment !== context.environment
  ) {
    throw new Error('World ID proof context does not match this publication')
  }

  validateCredentialResponses(result.responses, context.signalHash)
  return result
}

export function isWorldIdSessionResult(result: IDKitResult | undefined): result is IDKitResultSession {
  return Boolean(
    result &&
    result.protocol_version === '4.0' &&
    'session_id' in result &&
    !('action' in result)
  )
}

export function validateSessionCredentialResponses(responses: ResponseItemSession[] | undefined): string[] {
  if (!responses || responses.length === 0) {
    throw new Error('World ID session result does not contain a credential response')
  }

  const allowed = new Set<string>(WORLD_ID_ALLOWED_CREDENTIALS)

  return responses.map((response) => {
    if (!allowed.has(response.identifier)) {
      throw new Error(`Unsupported World ID credential: ${response.identifier}`)
    }

    if (!Array.isArray(response.proof) || !Array.isArray(response.session_nullifier)) {
      throw new Error('World ID result is not a v4 session proof response')
    }

    return response.identifier
  })
}

export function validateWorldIdSessionResult(result: IDKitResult | undefined, context: WorldIdSessionContext): IDKitResultSession {
  if (!isWorldIdSessionResult(result)) {
    throw new Error('World ID 4.0 session proof is required')
  }

  if (
    result.nonce !== context.nonce ||
    result.environment !== context.environment
  ) {
    throw new Error('World ID session proof context does not match this login')
  }

  validateSessionCredentialResponses(result.responses)
  return result
}
