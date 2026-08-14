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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DRAFT_SHORTCUT_UPDATED_EVENT,
  type DraftShortcutUpdate,
} from '@/lib/draft-events'

type DraftsResponse = {
  success?: boolean
  drafts?: FeedItemD[]
}

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

  const loadDrafts = useCallback(async () => {
    if (requestInFlightRef.current) return
    requestInFlightRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const raw = await fetch('/api/drafts', { signal: controller.signal })
      const response = await raw.json() as DraftsResponse
      if (raw.ok && response.success && response.drafts) {
        setDrafts(response.drafts.slice(0, 5).map(draft => ({
          ...draft,
          ...liveUpdatesRef.current.get(draft.id),
        })))
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
  }, [])

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

const DraftMenuEntries = ({ drafts, loaded }: { drafts: FeedItemD[]; loaded: boolean }) => (
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
    {drafts.map(draft => (
      <DropdownMenuItem key={draft.id} asChild>
        <Link href={`/d/${draft.id}`} title={draftLabel(draft)}>
          <Pencil className="h-4 w-4" />
          <span className="truncate">{draftLabel(draft)}</span>
        </Link>
      </DropdownMenuItem>
    ))}
    <DropdownMenuSeparator />
    <DropdownMenuItem asChild>
      <Link href="/activity">Activity</Link>
    </DropdownMenuItem>
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
        <DraftMenuEntries drafts={drafts} loaded={loaded} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const YourDraftsMobileMenu = () => {
  const { drafts, loaded, loadDrafts } = useDraftShortcuts()

  return (
    <DropdownMenuSub
      onOpenChange={open => {
        if (open) loadDrafts()
      }}
    >
      <DropdownMenuSubTrigger>
        <Files className="h-4 w-4" />
        Your drafts
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <DraftMenuEntries drafts={drafts} loaded={loaded} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
