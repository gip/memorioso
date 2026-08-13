// Device-local storage for a draft written before signing in. The editor keeps
// anonymous work here and adopts it into the account on the next login, so a
// first-time visitor can start typing without an account.
//
// This is deliberately a single slot: it holds the one unsaved draft in
// progress, and is cleared as soon as that draft reaches the database.

import { type PublicationContent } from '@/types';

const LOCAL_DRAFT_KEY = 'memorioso.draft.local.v1';

export type LocalDraft = {
  title: string;
  subtitle: string;
  content: PublicationContent;
  savedAt: string;
};

const isPublicationContent = (value: unknown): value is PublicationContent =>
  typeof value === 'object' && value !== null && typeof (value as PublicationContent).html === 'string';

/**
 * Reads the locally stored draft. Returns null when there is none, when storage
 * is unavailable (SSR, private mode, disabled cookies), or when the stored value
 * is not a draft we recognise.
 */
export const readLocalDraft = (): LocalDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    if (!isPublicationContent(parsed.content)) {
      return null;
    }
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
      content: parsed.content,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    };
  } catch {
    return null;
  }
};

/** Persists the draft locally. Storage failures must never break the editor. */
export const writeLocalDraft = (draft: Omit<LocalDraft, 'savedAt'>): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const payload: LocalDraft = { ...draft, savedAt: new Date().toISOString() };
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
};

export const clearLocalDraft = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(LOCAL_DRAFT_KEY);
  } catch {
    // Nothing to do: the draft is already saved server-side by every caller.
  }
};
