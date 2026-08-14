import type { PublicationContent, PublicationKind } from '@/types'

export const DRAFT_SHORTCUT_UPDATED_EVENT = 'memorioso:draft-shortcut-updated'

export type DraftShortcutUpdate = {
  id: string
  title: string
  content: PublicationContent
  publicationType: PublicationKind
}

export const announceDraftShortcutUpdate = (draft: DraftShortcutUpdate): void => {
  window.dispatchEvent(
    new CustomEvent<DraftShortcutUpdate>(DRAFT_SHORTCUT_UPDATED_EVENT, { detail: draft })
  )
}
