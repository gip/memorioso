'use client'

// The one-shot handoff of World ID proof material from a login to the draft key.
//
// The secret exists for a single moment — inside the login handler, before the
// proof is handed to the verifier — and the code that needs it runs elsewhere.
// It is passed through this module rather than through React state or context on
// purpose: state would keep it alive in the component tree and visible in
// devtools, and there is no reason for it to outlive the unlock it enables.

import type { IDKitResultSession } from '@worldcoin/idkit'

type Listener = (secret: string) => void

let latestSecret: string | null = null
const listeners = new Set<Listener>()

/**
 * Reads the key-derivation secret out of a session login result.
 *
 * `session_nullifier[0]` is stored as `users.world_id_session_nullifier` and so
 * would be in any database dump this feature exists to devalue. Index [1] is
 * used nowhere on the server, which is what makes it usable here.
 */
export function draftKeySecretFromLogin(result: IDKitResultSession): string | null {
  const nullifiers = result.responses?.[0]?.session_nullifier
  const secret = Array.isArray(nullifiers) ? nullifiers[1] : undefined
  return typeof secret === 'string' && secret.length > 0 ? secret : null
}

/** Publishes the secret from a login that just succeeded. */
export function publishLoginSecret(secret: string): void {
  latestSecret = secret
  for (const listener of listeners) listener(secret)
}

/**
 * Takes the pending secret, if a login produced one and nothing has consumed it
 * yet. Reading it clears it: it is good for exactly one unlock.
 */
export function consumeLoginSecret(): string | null {
  const secret = latestSecret
  latestSecret = null
  return secret
}

/** Notifies on the next login, for a consumer that was already mounted. */
export function onLoginSecret(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Drops anything pending, on sign-out or once an unlock has finished with it. */
export function clearLoginSecret(): void {
  latestSecret = null
}
