'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Files, Loader2, Pencil } from 'lucide-react'
import { extractReadableText } from '@libro/core'

import type { FeedItemD } from '@/components/FeedItem'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DRAFT_SHORTCUT_UPDATED_EVENT,
  type DraftShortcutUpdate,
} from '@/lib/draft-events'
import { useDraftKey } from '@/lib/draft-crypto/provider'
import { LOCKED_DRAFT_TITLE, revealDraftRows } from '@/lib/draft-crypto/rows'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

type DraftsResponse = {
  success?: boolean
  drafts?: FeedItemD[]
}

/** Keep the inline mobile group short enough to fit a phone viewport. */
const MOBILE_DRAFT_LIMIT = 3

const draftLabel = (draft: FeedItemD): string => {
  const title = draft.title?.trim()
  if (title) return title

  const excerpt = extractReadableText(draft.content.html).trim()
  return excerpt || 'Untitled draft'
}

const useDraftShortcuts = () => {
  const [drafts, setDrafts] = useState<FeedItemD[]>([])
  const [loaded, setLoaded] = useState(false)
  const requestInFlightRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const liveUpdatesRef = useRef(new Map<string, DraftShortcutUpdate>())
  const { key: draftKey } = useDraftKey()
  const { user } = useWorldIdAuth()
  const userId = user?.id ?? null

  const loadDrafts = useCallback(async () => {
    if (requestInFlightRef.current) return
    requestInFlightRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const raw = await fetch('/api/drafts', { signal: controller.signal })
      const response = await raw.json() as DraftsResponse
      if (raw.ok && response.success && response.drafts) {
        const revealed = await revealDraftRows(response.drafts.slice(0, 5), draftKey, userId)
        setDrafts(revealed.map(draft => ({
          ...draft,
          title: draft.locked ? LOCKED_DRAFT_TITLE : draft.title,
          // A live update comes from the open editor, where the draft is already
          // decrypted, so it wins over a row this device could not read.
          ...liveUpdatesRef.current.get(draft.id),
        })) as FeedItemD[])
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Failed to load draft shortcuts:', error)
      }
    } finally {
      if (controllerRef.current === controller) {
        requestInFlightRef.current = false
        if (!controller.signal.aborted) setLoaded(true)
      }
    }
  }, [draftKey, userId])

  useEffect(() => {
    const updateShortcut = (event: Event) => {
      const updated = (event as CustomEvent<DraftShortcutUpdate>).detail
      liveUpdatesRef.current.set(updated.id, updated)
      setDrafts(previous => {
        const existingIndex = previous.findIndex(draft => draft.id === updated.id)
        if (existingIndex === -1) {
          return [updated, ...previous].slice(0, 5)
        }

        const next = [...previous]
        next[existingIndex] = { ...next[existingIndex], ...updated }
        return next
      })
    }

    window.addEventListener(DRAFT_SHORTCUT_UPDATED_EVENT, updateShortcut)
    return () => {
      controllerRef.current?.abort()
      window.removeEventListener(DRAFT_SHORTCUT_UPDATED_EVENT, updateShortcut)
    }
  }, [])

  return { drafts, loaded, loadDrafts }
}

type DraftItemsProps = {
  drafts: FeedItemD[]
  loaded: boolean
  limit?: number
}

const DraftItems = ({ drafts, loaded, limit }: DraftItemsProps) => (
  <>
    {!loaded && (
      <DropdownMenuItem disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading drafts…
      </DropdownMenuItem>
    )}
    {loaded && drafts.length === 0 && (
      <DropdownMenuItem disabled>No current drafts</DropdownMenuItem>
    )}
    {(limit ? drafts.slice(0, limit) : drafts).map(draft => (
      <DropdownMenuItem key={draft.id} asChild>
        <Link href={`/d/${draft.id}`} title={draftLabel(draft)}>
          <Pencil className="h-4 w-4" />
          <span className="truncate">{draftLabel(draft)}</span>
        </Link>
      </DropdownMenuItem>
    ))}
  </>
)

export const YourDraftsButton = () => {
  const { drafts, loaded, loadDrafts } = useDraftShortcuts()

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) loadDrafts()
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-0 justify-start px-3">
          <Files className="h-4 w-4 shrink-0" />
          <span className="truncate">Your drafts</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DraftItems drafts={drafts} loaded={loaded} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/activity">Activity</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Narrow viewports have no room for a flyout submenu: the parent menu is
 * already flush right, so a nested panel gets clipped off the left edge.
 * Render the drafts inline as a labelled group instead and grow downward.
 */
export const YourDraftsMenuGroup = () => {
  const { drafts, loaded, loadDrafts } = useDraftShortcuts()

  // Menu content unmounts on close, so mounting is the menu-open signal.
  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Files className="h-3.5 w-3.5 shrink-0" />
        Your drafts
      </DropdownMenuLabel>
      <DraftItems drafts={drafts} loaded={loaded} limit={MOBILE_DRAFT_LIMIT} />
    </DropdownMenuGroup>
  )
}
