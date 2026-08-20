// The reading feed. The first page is server-rendered from a cached query so it
// ships inside the prerendered HTML instead of arriving a round trip after
// hydration; the rest pages in on scroll through <LatestPublicationsLoadMore>.

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

export const LatestPublications = async ({
  pageSize = 5,
  className,
  type = 'article',
  showHeading = true,
}: LatestPublicationsProps) => {
  // One extra row tells us whether another page exists without a count. A build
  // host with no database (previews, Openship sandbox builds) prerenders without
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
