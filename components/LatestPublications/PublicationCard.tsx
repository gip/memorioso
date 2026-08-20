// One row of the reading feed. Deliberately free of client-only APIs so the
// same card renders in the server-prerendered first page and in the client
// pages that infinite scroll appends.

import { TextListCard } from '@/components/TextListCard'
import { RelativeTime } from '@/components/RelativeTime'
import { publicationPath } from '@/lib/publication-kind'
import { type PublicationInfo } from '@/types'

export const PublicationCard = ({ publication }: { publication: PublicationInfo }) => (
  <TextListCard
    href={publicationPath(publication.publication_type, publication.id)}
    title={publication.publication_title}
    excerpt={publication.publication_excerpt}
    subtitle={publication.publication_subtitle}
    authorshipLabel={publication.authorship_label}
    metaText={
      <>
        {publication.author_name_libro} · <RelativeTime date={publication.publication_date} />
      </>
    }
  />
)

export const FEED_EXHAUSTED_MESSAGE = 'That is every matching signed publication so far.'

export const FeedExhausted = () => (
  <p className="py-8 text-center text-xs text-muted-foreground">{FEED_EXHAUSTED_MESSAGE}</p>
)
