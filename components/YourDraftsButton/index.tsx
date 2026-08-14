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
  const requestStartedRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)

  const loadDrafts = useCallback(async () => {
    if (requestStartedRef.current) return
    requestStartedRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const raw = await fetch('/api/drafts', { signal: controller.signal })
      const response = await raw.json() as DraftsResponse
      if (raw.ok && response.success && response.drafts) {
        setDrafts(response.drafts.slice(0, 5))
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Failed to load draft shortcuts:', error)
      }
    } finally {
      if (!controller.signal.aborted) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    return () => controllerRef.current?.abort()
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
      <Link href="/activity">View all activity</Link>
    </DropdownMenuItem>
  </>
)

export const YourDraftsButton = () => {
  const { drafts, loaded, loadDrafts } = useDraftShortcuts()

  return (
    <div className="flex w-full">
      <Button
        variant="outline"
        className="min-w-0 flex-1 justify-start rounded-r-none border-r-0 px-3"
        asChild
      >
        <Link href="/activity">
          <Files className="h-4 w-4 shrink-0" />
          <span className="truncate">Your drafts</span>
        </Link>
      </Button>

      <DropdownMenu onOpenChange={open => {
        if (open) loadDrafts()
      }}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="w-9 rounded-l-none px-0"
            aria-label="Choose a draft to edit"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DraftMenuEntries drafts={drafts} loaded={loaded} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const YourDraftsMobileMenu = () => {
  const { drafts, loaded, loadDrafts } = useDraftShortcuts()

  return (
    <div className="flex items-stretch">
      <DropdownMenuItem asChild className="min-w-0 flex-1 rounded-r-none">
        <Link href="/activity">
          <Files className="h-4 w-4" />
          Your drafts
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSub onOpenChange={open => {
        if (open) loadDrafts()
      }}>
        <DropdownMenuSubTrigger
          className="w-9 justify-center rounded-l-none px-0 [&>svg]:ml-0"
          aria-label="Choose a draft to edit"
        >
          <span className="sr-only">Choose a draft to edit</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-60">
          <DraftMenuEntries drafts={drafts} loaded={loaded} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  )
}
