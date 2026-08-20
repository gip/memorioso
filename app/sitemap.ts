import type { MetadataRoute } from 'next'
import { publicationPath } from '@/lib/publication-kind'

// Matches the canonical URLs emitted in metadata (app/layout.tsx, CanonicalPublicationPage).
const BASE_URL = 'https://memorioso.xyz'

// Only routes a signed-out visitor can actually reach. /activity, /authors, /info, /profile,
// and /d/* redirect or require a session, and proof and /hash/* pages are secondary views
// of a publication that is already listed here.
const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: BASE_URL, changeFrequency: 'daily', priority: 1 },
  { url: `${BASE_URL}/latest`, changeFrequency: 'daily', priority: 0.8 },
  { url: `${BASE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.6 },
  { url: `${BASE_URL}/openship`, changeFrequency: 'weekly', priority: 0.5 },
  { url: `${BASE_URL}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
  { url: `${BASE_URL}/terms`, changeFrequency: 'monthly', priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The sitemap is prerendered at build time, and some build hosts (previews,
  // Openship sandbox builds) have no database. Without one there is nothing to
  // enumerate, so emit the static routes alone instead of failing the build.
  if (!process.env.DATABASE_URL) {
    return STATIC_ROUTES
  }

  const { getCachedSitemapAuthors, getCachedSitemapPublications } = await import(
    '@/lib/db/publication-cache'
  )
  const [publications, authors] = await Promise.all([
    getCachedSitemapPublications(),
    getCachedSitemapAuthors(),
  ])

  return [
    ...STATIC_ROUTES,
    ...authors.map((author) => ({
      url: `${BASE_URL}/@${author.handle}`,
      lastModified: author.lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    // Publications are immutable once signed, so they never need re-crawling.
    ...publications.map((publication) => ({
      url: `${BASE_URL}${publicationPath(publication.kind, publication.id)}`,
      lastModified: publication.lastModified,
      changeFrequency: 'never' as const,
      priority: 0.7,
    })),
  ]
}
