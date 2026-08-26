'use client'

// Moving drafts written before encryption over to it.
//
// Runs in the browser once per unlock, because that is the only place the key
// exists. It is idempotent — a row that is already encrypted is skipped, and a
// row that fails is simply left for the next unlock — so there is no state to
// track and nothing to resume.

import { DRAFT_ENCRYPTION_V1, encryptDraft } from '@/lib/draft-crypto'
import type { PublicationContent } from '@/types'

type PlaintextDraftRow = {
  id: string
  encryption?: string | null
  title?: string | null
  subtitle?: string | null
  content?: PublicationContent | null
  history?: { source?: string } | null
  authorId?: string | null
  access?: string | null
}

export type MigrationResult = {
  migrated: number
  remaining: number
}

/**
 * Encrypts every plaintext draft this author still has.
 *
 * Extension inline-signing drafts are left alone: the server writes them and
 * publishes them within the same flow, so encrypting one would only race that
 * flow for a row that is about to be deleted.
 */
export async function migratePlaintextDrafts(key: CryptoKey, userId: number): Promise<MigrationResult> {
  const raw = await fetch('/api/drafts')
  const body = await raw.json() as { success?: boolean; drafts?: PlaintextDraftRow[] }
  if (!raw.ok || !body.success || !body.drafts) {
    return { migrated: 0, remaining: 0 }
  }

  const pending = body.drafts.filter((draft) =>
    draft.encryption !== DRAFT_ENCRYPTION_V1 && draft.history?.source !== 'chrome_extension'
  )

  let migrated = 0
  for (const draft of pending) {
    try {
      const ciphertext = await encryptDraft(key, { draftId: draft.id, userId }, {
        title: draft.title || '',
        subtitle: draft.subtitle || '',
        content: draft.content || { html: '' },
      })

      const response = await fetch(`/api/draft/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          encryption: DRAFT_ENCRYPTION_V1,
          ciphertext,
          // PUT rewrites every column it is given, so what is not being changed
          // has to be sent back as it was.
          history: draft.history ?? undefined,
          authorId: draft.authorId ?? null,
          access: draft.access ?? undefined,
        }),
      })
      if (response.ok) migrated += 1
    } catch {
      // Left for the next unlock. A draft that will not migrate is still
      // readable, because it is still plaintext.
    }
  }

  return { migrated, remaining: pending.length - migrated }
}
