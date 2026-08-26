'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { useRouter } from 'next/navigation'

import { DeleteDraftDialog } from '@/components/DeleteDraftDialog'
import type { FeedItemD } from '@/components/FeedItem'
import { FeedItem } from '@/components/FeedItem'
import { useDraftKey } from '@/lib/draft-crypto/provider'
import { LOCKED_DRAFT_TITLE, revealDraftRows } from '@/lib/draft-crypto/rows'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

type FeedStatus = 'loading' | 'ready'

export const Feed = () => {
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading')
  const [feedItems, setFeedItems] = useState<FeedItemD[]>([])
  const [feedError, setFeedError] = useState<string | null>(null)
  const [draftToDelete, setDraftToDelete] = useState<FeedItemD | null>(null)
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null)
  const router = useRouter()
  const { key: draftKey, status: draftKeyStatus } = useDraftKey()
  const { user } = useWorldIdAuth()

  // Waits for the key, so a draft that is merely still unlocking is not shown
  // as locked for the moment it takes.
  useEffect(() => {
    if (draftKeyStatus === 'loading') return

    let cancelled = false
    const fetchData = async () => {
      try {
        const raw = await fetch('/api/drafts');
        const response = await raw.json();
        if (response.success && !cancelled) {
          const drafts = await revealDraftRows(response.drafts.slice(0, 5), draftKey, user?.id ?? null)
          if (cancelled) return
          setFeedItems(drafts.map((draft) => ({
            ...draft,
            title: draft.locked ? LOCKED_DRAFT_TITLE : draft.title,
          })) as FeedItemD[])
          setFeedStatus('ready')
        }
      } catch (error) {
        console.error('Failed to fetch drafts:', error)
      }
    };

    fetchData();
    return () => {
      cancelled = true
    }
  }, [draftKey, draftKeyStatus, user?.id]);

  const deleteDraft = async (draft: FeedItemD) => {
    setDeletingDraftId(draft.id)
    setFeedError(null)
    try {
      const raw = await fetch(`/api/draft/${draft.id}`, { method: 'DELETE' })
      const response = await raw.json() as { success?: boolean; message?: string }
      if (!raw.ok || !response.success) {
        throw new Error(response.message || 'Failed to delete draft')
      }

      setFeedItems(previous => previous.filter(item => item.id !== draft.id))
      setDraftToDelete(null)
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Failed to delete draft')
    } finally {
      setDeletingDraftId(null)
    }
  }

  const EmptyFeed = () => (
    <div className="py-6 text-center">
      <p className="text-muted-foreground mb-4">You have no drafts yet.</p>
      <Button onClick={() => router.push('/d/new')}>
        Start writing
      </Button>
    </div>
  )

  const FeedContent = () => (
    <div className="space-y-3">
      {feedItems && feedItems.length > 0 ? (
        feedItems.map((item) => (
          <div key={item.id} className="relative [&>a]:pr-14">
            <FeedItem item={item} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDraftToDelete(item)}
              disabled={deletingDraftId === item.id}
            >
              {deletingDraftId === item.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">
                {deletingDraftId === item.id ? 'Deleting…' : 'Delete'}
              </span>
            </Button>
          </div>
        ))
      ) : (
        <EmptyFeed />
      )}
    </div>
  )

  const FeedLoading = () => (
    <div className="space-y-3">
      <FeedItem item={null} />
      <FeedItem item={null} />
    </div>
  )

  // Width and section spacing come from the surrounding page container.
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your Drafts
        </h2>
        <Link href="/activity" className="text-xs text-blurple hover:underline">
          View activity
        </Link>
      </div>
      {feedError && !draftToDelete && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {feedError}
        </p>
      )}
      {feedStatus === 'loading' && <FeedLoading />}
      {feedStatus === 'ready' && <FeedContent />}
      <DeleteDraftDialog
        open={draftToDelete !== null}
        draftTitle={draftToDelete?.title}
        errorMessage={feedError}
        isDeleting={deletingDraftId !== null}
        onOpenChange={(open) => {
          if (!open) setDraftToDelete(null)
        }}
        onConfirm={() => {
          if (draftToDelete) deleteDraft(draftToDelete)
        }}
      />
    </div>
  )
}
