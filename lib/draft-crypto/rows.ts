'use client'

// Turning stored draft rows back into readable drafts.
//
// Every surface that lists or opens a draft goes through here, so there is one
// place that knows a row can be encrypted, one place that knows what a row looks
// like when the key is missing, and no surface that has to remember to decrypt.

import { decryptDraft, DRAFT_ENCRYPTION_V1, type DraftPlaintext } from '@/lib/draft-crypto'
import type { PublicationContent } from '@/types'

export type StoredDraftRow = {
  id: string
  encryption?: string | null
  ciphertext?: string | null
  title?: string | null
  subtitle?: string | null
  content?: PublicationContent | null
}

export type RevealedDraft<T> = Omit<T, 'title' | 'subtitle' | 'content' | 'ciphertext'> & DraftPlaintext & {
  /** True when the row is encrypted and this device cannot read it. */
  locked: boolean
}

const EMPTY: DraftPlaintext = { title: '', subtitle: '', content: { html: '' } }

/**
 * Decrypts one row, or reports it locked.
 *
 * A row that will not decrypt is never an error the caller has to handle: a
 * device without the key is an ordinary state, and the surfaces that show drafts
 * would rather render a placeholder than fail.
 */
export async function revealDraftRow<T extends StoredDraftRow>(
  row: T,
  key: CryptoKey | null,
  userId: number | null
): Promise<RevealedDraft<T>> {
  const { ciphertext, ...rest } = row

  if (row.encryption !== DRAFT_ENCRYPTION_V1) {
    return {
      ...rest,
      title: row.title || '',
      subtitle: row.subtitle || '',
      content: row.content || { html: '' },
      locked: false,
    } as RevealedDraft<T>
  }

  if (!key || userId === null || !ciphertext) {
    return { ...rest, ...EMPTY, locked: true } as RevealedDraft<T>
  }

  try {
    const plaintext = await decryptDraft(key, { draftId: row.id, userId }, ciphertext)
    return {
      ...rest,
      title: plaintext.title || '',
      subtitle: plaintext.subtitle || '',
      content: plaintext.content || { html: '' },
      locked: false,
    } as RevealedDraft<T>
  } catch {
    return { ...rest, ...EMPTY, locked: true } as RevealedDraft<T>
  }
}

export async function revealDraftRows<T extends StoredDraftRow>(
  rows: T[],
  key: CryptoKey | null,
  userId: number | null
): Promise<RevealedDraft<T>[]> {
  return Promise.all(rows.map((row) => revealDraftRow(row, key, userId)))
}

/** What a list shows in place of a title it cannot read. */
export const LOCKED_DRAFT_TITLE = 'Locked draft'
