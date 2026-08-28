'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import { FeedItem, type FeedItemD } from '@/components/FeedItem'
import { useDraftKey } from '@/lib/draft-crypto/provider'
import { LOCKED_DRAFT_TITLE, revealDraftRows } from '@/lib/draft-crypto/rows'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
import { DeleteDraftDialog } from '@/components/DeleteDraftDialog'
import { TextListCard } from '@/components/TextListCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { publicationPath } from '@/lib/publication-kind'
import { timeAgo } from '@/lib/time'
import type { PublicationInfo } from '@/types'

type DraftsResponse = {
  success?: boolean
  drafts?: FeedItemD[]
  message?: string
}

type PublicationsResponse = {
  success?: boolean
  publications?: PublicationInfo[]
  hasMore?: boolean
  message?: string
}

const PUBLICATION_PAGE_SIZE = 5

export const Activity = () => {
  const [drafts, setDrafts] = useState<FeedItemD[]>([])
  const [draftsLoaded, setDraftsLoaded] = useState(false)
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null)
  const [draftToDelete, setDraftToDelete] = useState<FeedItemD | null>(null)
  const [publications, setPublications] = useState<PublicationInfo[]>([])
  const [publicationsLoaded, setPublicationsLoaded] = useState(false)
  const [publicationsError, setPublicationsError] = useState<string | null>(null)
  const [hasMorePublications, setHasMorePublications] = useState(true)
  const [isLoadingPublications, setIsLoadingPublications] = useState(false)
  const [isPaginationArmed, setIsPaginationArmed] = useState(false)
  const publicationOffsetRef = useRef(0)
  const isFetchingPublicationsRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const { key: draftKey, status: draftKeyStatus } = useDraftKey()
  const { user } = useWorldIdAuth()

  // Waits for the key, so a draft that is merely still unlocking is not shown
  // as locked for the moment it takes.
  useEffect(() => {
    if (draftKeyStatus === 'loading') return

    let cancelled = false
    const loadDrafts = async () => {
      try {
        const raw = await fetch('/api/drafts')
        const response = await raw.json() as DraftsResponse
        if (!raw.ok || !response.success || !response.drafts) {
          throw new Error(response.message || 'Failed to load drafts')
        }
        const revealed = await revealDraftRows(response.drafts, draftKey, user?.id ?? null)
        if (cancelled) return
        setDrafts(revealed.map((draft) => ({
          ...draft,
          title: draft.locked ? LOCKED_DRAFT_TITLE : draft.title,
        })) as FeedItemD[])
      } catch (error) {
        if (!cancelled) setDraftsError(error instanceof Error ? error.message : 'Failed to load drafts')
      } finally {
        if (!cancelled) setDraftsLoaded(true)
      }
    }

    loadDrafts()
    return () => {
      cancelled = true
    }
  }, [draftKey, draftKeyStatus, user?.id])

  const loadMorePublications = useCallback(async () => {
    if (isFetchingPublicationsRef.current) return
    isFetchingPublicationsRef.current = true
    setIsLoadingPublications(true)
    setPublicationsError(null)

    try {
      const raw = await fetch(
        `/api/activity/publications?limit=${PUBLICATION_PAGE_SIZE}&offset=${publicationOffsetRef.current}`
      )
      const response = await raw.json() as PublicationsResponse
      if (!raw.ok || !response.success || !response.publications) {
        throw new Error(response.message || 'Failed to load published work')
      }

      publicationOffsetRef.current += response.publications.length
      setPublications(previous => [...previous, ...response.publications!])
      setHasMorePublications(response.hasMore === true)
    } catch (error) {
      setPublicationsError(
        error instanceof Error ? error.message : 'Failed to load published work'
      )
    } finally {
      isFetchingPublicationsRef.current = false
      setIsLoadingPublications(false)
      setPublicationsLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadMorePublications()
  }, [loadMorePublications])

  useEffect(() => {
    if (isPaginationArmed) return
    const armPagination = () => setIsPaginationArmed(true)
    document.addEventListener('scroll', armPagination, {
      once: true,
      capture: true,
      passive: true,
    })
    window.addEventListener('wheel', armPagination, { once: true, passive: true })
    window.addEventListener('touchmove', armPagination, { once: true, passive: true })
    return () => {
      document.removeEventListener('scroll', armPagination, true)
      window.removeEventListener('wheel', armPagination)
      window.removeEventListener('touchmove', armPagination)
    }
  }, [isPaginationArmed])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMorePublications || !isPaginationArmed) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) loadMorePublications()
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMorePublications, isPaginationArmed, loadMorePublications, publications.length])

  const deleteDraft = async (draft: FeedItemD) => {
    setDeletingDraftId(draft.id)
    setDraftsError(null)
    try {
      const raw = await fetch(`/api/draft/${draft.id}`, { method: 'DELETE' })
      const response = await raw.json() as { success?: boolean; message?: string }
      if (!raw.ok || !response.success) {
        throw new Error(response.message || 'Failed to delete draft')
      }
      setDrafts(previous => previous.filter(item => item.id !== draft.id))
      setDraftToDelete(null)
    } catch (error) {
      setDraftsError(error instanceof Error ? error.message : 'Failed to delete draft')
    } finally {
      setDeletingDraftId(null)
    }
  }

  return (
    <main className="w-full min-w-0 py-8">
      <div className="mb-8">
        <h1 className="spectral text-3xl font-semibold">Your activity</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Continue your drafts or revisit work you have published.
        </p>
      </div>

      <section aria-labelledby="activity-drafts-heading">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2
            id="activity-drafts-heading"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Current drafts
          </h2>
          <Button variant="outline" size="sm" asChild>
            <Link href="/d/new">New draft</Link>
          </Button>
        </div>

        {draftsError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {draftsError}
          </p>
        )}

        {!draftsLoaded && (
          <div className="space-y-3">
            <Skeleton className="h-[86px] w-full rounded-xl" />
            <Skeleton className="h-[86px] w-full rounded-xl" />
          </div>
        )}

        {draftsLoaded && drafts.length === 0 && (
          <div className="rounded-xl border border-dashed px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">You have no current drafts.</p>
          </div>
        )}

        {draftsLoaded && drafts.length > 0 && (
          <div className="space-y-3">
            {drafts.map(draft => (
              <div
                key={draft.id}
                className="relative [&>a]:pr-14"
              >
                <FeedItem item={draft} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 z-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDraftToDelete(draft)}
                  disabled={deletingDraftId === draft.id}
                >
                  {deletingDraftId === draft.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  <span className="sr-only">
                    {deletingDraftId === draft.id ? 'Deleting…' : 'Delete'}
                  </span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <DeleteDraftDialog
        open={draftToDelete !== null}
        draftTitle={draftToDelete?.title}
        errorMessage={draftsError}
        isDeleting={deletingDraftId !== null}
        onOpenChange={(open) => {
          if (!open) setDraftToDelete(null)
        }}
        onConfirm={() => {
          if (draftToDelete) deleteDraft(draftToDelete)
        }}
      />

      <section aria-labelledby="activity-publications-heading" className="mt-10">
        <h2
          id="activity-publications-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Published work
        </h2>

        {publicationsError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {publicationsError}
          </p>
        )}

        <div className="space-y-3 text-left">
          {publications.map(publication => (
            <TextListCard
              key={publication.id}
              href={publicationPath(publication.publication_type, publication.id)}
              title={publication.publication_title}
              excerpt={publication.publication_excerpt}
              subtitle={publication.publication_subtitle}
              authorshipLabel={publication.authorship_label}
              metaText={`${publication.author_name_libro} · ${timeAgo(publication.publication_date)}`}
            />
          ))}
          {!publicationsLoaded && (
            <>
              <Skeleton className="h-[86px] w-full rounded-xl" />
              <Skeleton className="h-[86px] w-full rounded-xl" />
            </>
          )}
        </div>

        {publicationsLoaded && publications.length === 0 && !publicationsError && (
          <div className="rounded-xl border border-dashed px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">You have not published any work yet.</p>
          </div>
        )}

        {hasMorePublications && <div ref={sentinelRef} aria-hidden className="h-px" />}
        {publicationsLoaded && isLoadingPublications && (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="sr-only">Loading more published work</span>
          </div>
        )}
        {publicationsLoaded && hasMorePublications && !isLoadingPublications && (
          <div className="flex justify-center py-6">
            <button
              type="button"
              onClick={loadMorePublications}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Show more
            </button>
          </div>
        )}
        {publicationsLoaded && !hasMorePublications && publications.length > 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            That is all of your published work.
          </p>
        )}
      </section>
    </main>
  )
}
