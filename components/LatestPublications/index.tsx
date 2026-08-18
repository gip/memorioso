'use client'

// The reading feed. Shows the most recent signed publications a page at a time
// and pulls the next page in as the reader scrolls, so the list is short on
// arrival but never dead-ends.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { type PublicationInfo } from '@/types'
import { TextListCard } from '@/components/TextListCard'
import { Skeleton } from '@/components/ui/skeleton'
import { timeAgo } from '@/lib/time'
import { publicationPath, type PublicationFeedKind } from '@/lib/publication-kind'

type LatestPublicationsProps = {
  /** Publications per page, and therefore how many show on arrival. */
  pageSize?: number
  className?: string
  type?: PublicationFeedKind
  showHeading?: boolean
}

type LatestResponse = {
  success?: boolean
  publications?: PublicationInfo[]
  hasMore?: boolean
}

export const LatestPublications = ({
  pageSize = 5,
  className,
  type = 'article',
  showHeading = true,
}: LatestPublicationsProps) => {
  const [publications, setPublications] = useState<PublicationInfo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  // The first page stays put until the reader scrolls. Arming the observer on
  // mount would fetch page two immediately whenever the list is shorter than
  // the viewport, which defeats showing a short list on arrival.
  const [isArmed, setIsArmed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Guards against a second fetch for the same page while one is in flight.
  const offsetRef = useRef(0)
  const isFetchingRef = useRef(false)
  // Bumped every time the list resets. A response that comes back under a stale
  // run id belongs to the previous list and must be dropped, or it appends a
  // second copy of page one on top of the fresh list.
  const runIdRef = useRef(0)

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current) return
    const runId = runIdRef.current
    isFetchingRef.current = true
    setIsLoading(true)
    try {
      const raw = await fetch(
        `/api/publications/latest?limit=${pageSize}&offset=${offsetRef.current}&type=${type}`
      )
      const response = await raw.json() as LatestResponse
      if (runId !== runIdRef.current) return
      if (response.success && response.publications) {
        offsetRef.current += response.publications.length
        setPublications(previous => [...previous, ...response.publications!])
        setHasMore(response.hasMore === true)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to fetch latest publications:', error)
      if (runId === runIdRef.current) setHasMore(false)
    } finally {
      if (runId === runIdRef.current) {
        isFetchingRef.current = false
        setIsLoading(false)
        setLoaded(true)
      }
    }
  }, [pageSize, type])

  useEffect(() => {
    runIdRef.current += 1
    setPublications([])
    setLoaded(false)
    setHasMore(true)
    setIsArmed(false)
    offsetRef.current = 0
    isFetchingRef.current = false
    loadMore()
  }, [loadMore])

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

  // Pull the next page in slightly before the sentinel reaches the viewport.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || !isArmed) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          loadMore()
        }
      },
      { rootMargin: '200px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isArmed, loadMore, publications.length])

  // Nothing to show: stay out of the way so the layout collapses cleanly.
  if (loaded && publications.length === 0) return null

  return (
    <div className={className}>
      {showHeading && (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latest Articles
        </h2>
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
        {!loaded && (
          <>
            <Skeleton className="h-[86px] w-full rounded-xl" />
            <Skeleton className="h-[86px] w-full rounded-xl" />
          </>
        )}
      </div>
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
      {loaded && isLoading && (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="sr-only">Loading more publications</span>
        </div>
      )}
      {/* Keeps a click path to the rest when the list is too short to scroll. */}
      {loaded && hasMore && !isLoading && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={loadMore}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Show more
          </button>
        </div>
      )}
      {loaded && !hasMore && publications.length > 0 && (
        <p className="py-8 text-center text-xs text-muted-foreground">
          That is every matching signed publication so far.
        </p>
      )}
    </div>
  )
}
