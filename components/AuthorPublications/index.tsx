'use client'

// Tabbed publication feed for an author's page. Same TextListCard box used on
// every other feed in the app, split into Articles / Shorts tabs so a reader
// can find either without scrolling through both mixed together.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PublicationInfo } from '@/types'
import { TextListCard } from '@/components/TextListCard'
import { Skeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/time'
import { publicationPath, type PublicationKind } from '@/lib/publication-kind'
import type { AuthorPublicationCounts } from '@/lib/db/objects'

type AuthorPublicationsProps = {
  authorId: string
  counts: AuthorPublicationCounts
}

type PublicationsResponse = {
  success?: boolean
  publications?: PublicationInfo[]
  hasMore?: boolean
}

const PAGE_SIZE = 10

const TABS: { kind: PublicationKind; label: string }[] = [
  { kind: 'article', label: 'Articles' },
  { kind: 'short', label: 'Shorts' },
]

export const AuthorPublications = ({ authorId, counts }: AuthorPublicationsProps) => {
  const [activeTab, setActiveTab] = useState<PublicationKind>(
    counts.article > 0 || counts.short === 0 ? 'article' : 'short'
  )
  const [publications, setPublications] = useState<PublicationInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)
  const isFetchingRef = useRef(false)
  // Bumped every time the list resets (tab switch, remount). A response that comes
  // back under a stale run id belongs to the previous list and must be dropped, or
  // it appends a second copy of page one on top of the fresh list.
  const runIdRef = useRef(0)

  const loadMore = useCallback(async (tab: PublicationKind) => {
    if (isFetchingRef.current) return
    const runId = runIdRef.current
    isFetchingRef.current = true
    setIsLoading(true)
    try {
      const raw = await fetch(
        `/api/author/${authorId}/publications?limit=${PAGE_SIZE}&offset=${offsetRef.current}&type=${tab}`
      )
      const response = await raw.json() as PublicationsResponse
      if (runId !== runIdRef.current) return
      if (response.success && response.publications) {
        offsetRef.current += response.publications.length
        setPublications(previous => [...previous, ...response.publications!])
        setHasMore(response.hasMore === true)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to fetch author publications:', error)
      if (runId === runIdRef.current) setHasMore(false)
    } finally {
      if (runId === runIdRef.current) {
        isFetchingRef.current = false
        setIsLoading(false)
        setLoaded(true)
      }
    }
  }, [authorId])

  useEffect(() => {
    runIdRef.current += 1
    setPublications([])
    setLoaded(false)
    setHasMore(true)
    setIsArmed(false)
    offsetRef.current = 0
    isFetchingRef.current = false
    loadMore(activeTab)
  }, [activeTab, loadMore])

  useEffect(() => {
    if (isArmed) return
    const arm = () => setIsArmed(true)
    window.addEventListener('scroll', arm, { once: true, passive: true })
    window.addEventListener('wheel', arm, { once: true, passive: true })
    window.addEventListener('touchmove', arm, { once: true, passive: true })
    return () => {
      window.removeEventListener('scroll', arm)
      window.removeEventListener('wheel', arm)
      window.removeEventListener('touchmove', arm)
    }
  }, [isArmed])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || !isArmed) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          loadMore(activeTab)
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [activeTab, hasMore, isArmed, loadMore, publications.length])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.kind}
            onClick={() => setActiveTab(tab.kind)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.kind
                ? 'border-blurple text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label} <span className="text-xs text-muted-foreground">({counts[tab.kind]})</span>
          </button>
        ))}
      </div>

      <div className="space-y-3 text-left">
        {publications.map(publication => (
          <TextListCard
            key={publication.id}
            href={publicationPath(publication.publication_type, publication.id)}
            title={publication.publication_title}
            excerpt={publication.publication_excerpt}
            subtitle={publication.publication_subtitle}
            authorshipLabel={publication.authorship_label}
            metaText={timeAgo(publication.publication_date)}
          />
        ))}
        {!loaded && (
          <>
            <Skeleton className="h-[86px] w-full rounded-xl" />
            <Skeleton className="h-[86px] w-full rounded-xl" />
          </>
        )}
        {loaded && publications.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No {activeTab === 'article' ? 'articles' : 'shorts'} yet.
          </p>
        )}
      </div>

      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
      {loaded && isLoading && (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="sr-only">Loading more publications</span>
        </div>
      )}
      {loaded && hasMore && !isLoading && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={() => loadMore(activeTab)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  )
}
