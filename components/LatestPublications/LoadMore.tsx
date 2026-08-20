'use client'

// Pages two and onward of the reading feed. Page one is server-rendered and
// cached into the prerendered shell by <LatestPublications>, so this component
// starts empty and only fetches once the reader shows intent: arming on the
// first scroll keeps a short list from pulling the next page on arrival.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { type PublicationInfo } from '@/types'
import { type PublicationFeedKind } from '@/lib/publication-kind'
import { FeedExhausted, PublicationCard } from './PublicationCard'

type LoadMoreProps = {
  pageSize: number
  type: PublicationFeedKind
  /** How many rows the server already rendered above this component. */
  initialOffset: number
}

type LatestResponse = {
  success?: boolean
  publications?: PublicationInfo[]
  hasMore?: boolean
}

export const LatestPublicationsLoadMore = ({ pageSize, type, initialOffset }: LoadMoreProps) => {
  const [publications, setPublications] = useState<PublicationInfo[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Guards against a second fetch for the same page while one is in flight.
  const offsetRef = useRef(initialOffset)
  const isFetchingRef = useRef(false)

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    setIsLoading(true)
    try {
      const raw = await fetch(
        `/api/publications/latest?limit=${pageSize}&offset=${offsetRef.current}&type=${type}`
      )
      const response = await raw.json() as LatestResponse
      if (response.success && response.publications) {
        offsetRef.current += response.publications.length
        setPublications(previous => [...previous, ...response.publications!])
        setHasMore(response.hasMore === true)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      console.error('Failed to fetch latest publications:', error)
      setHasMore(false)
    } finally {
      isFetchingRef.current = false
      setIsLoading(false)
    }
  }, [pageSize, type])

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

  return (
    <>
      {publications.length > 0 && (
        <div className="mt-3 space-y-3 text-left">
          {publications.map(publication => (
            <PublicationCard key={publication.id} publication={publication} />
          ))}
        </div>
      )}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
      {isLoading && (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="sr-only">Loading more publications</span>
        </div>
      )}
      {/* Keeps a click path to the rest when the list is too short to scroll. */}
      {hasMore && !isLoading && (
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
      {!hasMore && <FeedExhausted />}
    </>
  )
}
