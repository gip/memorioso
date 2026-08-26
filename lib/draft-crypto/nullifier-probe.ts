'use client'

// TEMPORARY — Phase 0 of encrypted drafts. Delete this file once the question is settled.
//
// Encrypted drafts want a key that is deterministic for one author across every
// browser and platform, and that the Memorioso database never holds. The
// candidate is `responses[0].session_nullifier[1]` from an IDKit session login:
// index [0] is persisted as `users.world_id_session_nullifier`, index [1] is
// used nowhere. Whether it is stable across logins is undocumented, so measure
// it before building on it.
//
// This probe only ever writes fingerprints — SHA-256 of the value, never the
// value — to the console and to localStorage, so comparing repeat logins in one
// browser needs no note-taking. Nothing is sent anywhere.

import type { IDKitResultSession } from '@worldcoin/idkit'

const PROBE_STORAGE_KEY = 'memorioso.nullifier.probe.v1'
const PROBE_TAG = '[nullifier-probe]'

type ProbeRecord = {
  at: string
  sessionId: string
  fingerprints: string[]
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const readHistory = (): ProbeRecord[] => {
  try {
    const raw = window.localStorage.getItem(PROBE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? (parsed as ProbeRecord[]) : []
  } catch {
    return []
  }
}

const writeHistory = (history: ProbeRecord[]): void => {
  try {
    window.localStorage.setItem(PROBE_STORAGE_KEY, JSON.stringify(history.slice(-10)))
  } catch {
    // A probe that cannot remember is still worth running; the console line stands alone.
  }
}

/**
 * Fingerprints the session nullifiers of a login and reports whether they match
 * the previous login seen in this browser. Never throws: a failed probe must not
 * be able to break a login.
 */
export async function probeSessionNullifier(result: IDKitResultSession): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const nullifiers = result.responses?.[0]?.session_nullifier
    if (!Array.isArray(nullifiers)) {
      console.warn(`${PROBE_TAG} no session_nullifier on responses[0]`, result.responses?.[0])
      return
    }

    const fingerprints = await Promise.all(nullifiers.map(sha256Hex))
    const record: ProbeRecord = {
      at: new Date().toISOString(),
      sessionId: result.session_id,
      fingerprints,
    }

    const history = readHistory()
    const previous = history[history.length - 1]

    console.log(`${PROBE_TAG} login at ${record.at}`)
    console.log(`${PROBE_TAG} session_id            ${record.sessionId}`)
    console.log(`${PROBE_TAG} nullifier count       ${fingerprints.length}`)
    fingerprints.forEach((fingerprint, index) => {
      const stability = previous?.fingerprints?.[index] === undefined
        ? 'first login in this browser'
        : previous.fingerprints[index] === fingerprint
          ? 'STABLE vs previous login'
          : 'CHANGED vs previous login'
      const persisted = index === 0 ? ' (persisted as users.world_id_session_nullifier)' : ''
      console.log(`${PROBE_TAG} nullifier[${index}] sha256  ${fingerprint}  — ${stability}${persisted}`)
    })
    console.log(
      `${PROBE_TAG} compare nullifier[1] against another browser or platform; ` +
      'it must be identical there for the World ID key source to work.'
    )

    writeHistory([...history, record])
  } catch (error) {
    console.warn(`${PROBE_TAG} failed`, error)
  }
}
