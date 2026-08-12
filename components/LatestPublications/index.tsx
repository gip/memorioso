'use client'

// Compact, responsive list of the most recent signed publications. Rendered on
// surfaces where there is spare space (e.g. the landing hero on wide screens).
// Fetches client-side from the public latest endpoint, mirroring the Feed pattern.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { type PublicationInfo } from '@/types'
import { TextListCard } from '@/components/TextListCard'
import { timeAgo } from '@/lib/time'

type LatestPublicationsProps = {
  limit?: number
  className?: string
}

export const LatestPublications = ({ limit = 4, className }: LatestPublicationsProps) => {
  const [publications, setPublications] = useState<PublicationInfo[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/publications/latest?limit=${limit}`)
      .then(raw => raw.json())
      .then(response => {
        if (active && response.success) {
          setPublications(response.publications)
        }
      })
      .catch(error => {
        console.error('Failed to fetch latest publications:', error)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [limit])

  // Nothing to show: stay out of the way so the layout collapses cleanly.
  if (loaded && publications.length === 0) return null

  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latest Publications
        </h2>
        <Link href="/latest" className="text-xs text-blurple hover:underline">
          See all
        </Link>
      </div>
      <div className="space-y-3 text-left">
        {publications.map(publication => (
          <TextListCard
            key={publication.id}
            href={`/p/${publication.id}`}
            title={publication.publication_title}
            excerpt={publication.publication_excerpt}
            subtitle={publication.publication_subtitle}
            authorshipLabel={publication.authorship_label}
            metaText={`${publication.author_name_libro} · ${timeAgo(publication.publication_date)}`}
          />
        ))}
      </div>
    </div>
  )
}
