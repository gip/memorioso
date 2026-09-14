// The first feed page renders on the server; later pages load on scroll.

import { Suspense } from 'react'
import { connection } from 'next/server'
import { libroServiceReadsEnabled } from '@/lib/libro-service/client'
import { getCachedLatestPublications } from '@/lib/db/publication-cache'
import { type PublicationFeedKind } from '@/lib/publication-kind'
import { FeedExhausted, PublicationCard } from './PublicationCard'
import { LatestPublicationsLoadMore } from './LoadMore'

type LatestPublicationsProps = {
  /** Publications per page, and therefore how many show on arrival. */
  pageSize?: number
  className?: string
  type?: PublicationFeedKind
  showHeading?: boolean
}

const LatestPublicationsContent = async ({
  pageSize = 5,
  className,
  type = 'article',
  showHeading = true,
}: LatestPublicationsProps) => {
  // Defer service reads until a request arrives, outside the cached query.
  if (process.env.DATABASE_URL && libroServiceReadsEnabled()) await connection()

  // One extra row tells us whether another page exists without a count. A build
  // host with no database (preview builds) prerenders without
  // a feed instead of failing the build; the check stays outside the cached call
  // so an empty feed is never what gets cached.
  const rows = process.env.DATABASE_URL
    ? await getCachedLatestPublications(pageSize + 1, 0, type)
    : []
  const publications = rows.slice(0, pageSize)
  const hasMore = rows.length > pageSize

  // Nothing to show: stay out of the way so the layout collapses cleanly.
  if (publications.length === 0) return null

  return (
    <div className={className}>
      {showHeading && (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latest Articles
        </h2>
      )}
      <div className="space-y-3 text-left">
        {publications.map(publication => (
          <PublicationCard key={publication.id} publication={publication} />
        ))}
      </div>
      {hasMore ? (
        <LatestPublicationsLoadMore
          pageSize={pageSize}
          type={type}
          initialOffset={publications.length}
        />
      ) : (
        <FeedExhausted />
      )}
    </div>
  )
}

export const LatestPublications = (props: LatestPublicationsProps) => (
  <Suspense fallback={null}>
    <LatestPublicationsContent {...props} />
  </Suspense>
)
