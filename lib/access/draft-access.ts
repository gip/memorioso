import type { PublicationAccess, PublicationKind } from '@/types'

export const PUBLICATION_ACCESS_VALUES: PublicationAccess[] = ['public', 'gated']

export function isPublicationAccess(value: unknown): value is PublicationAccess {
  return typeof value === 'string' && PUBLICATION_ACCESS_VALUES.includes(value as PublicationAccess)
}

/**
 * Shorts cap out around a couple of sentences, so a teaser of one is the whole post.
 * Gating them would be theatre, and their title already falls back to the body text.
 */
export function validateAccessForKind(
  access: PublicationAccess,
  kind: PublicationKind
): string | null {
  if (access === 'gated' && kind === 'short') return 'Shorts cannot be gated'
  return null
}
