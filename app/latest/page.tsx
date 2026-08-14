import Link from 'next/link'
import { LatestPublications } from '@/components/LatestPublications'
import { Divider } from '@/components/Divider'
import type { PublicationFeedKind } from '@/lib/publication-kind'

export const dynamic = 'force-dynamic'

const tabs: Array<{ label: string; type: PublicationFeedKind; href: string }> = [
  { label: 'Articles', type: 'article', href: '/latest' },
  { label: 'Shorts', type: 'short', href: '/latest?type=short' },
  { label: 'All', type: 'all', href: '/latest?type=all' },
]

const Page = async ({ searchParams }: { searchParams: Promise<{ type?: string }> }) => {
  const { type: requestedType } = await searchParams
  const type: PublicationFeedKind = requestedType === 'short' || requestedType === 'all'
    ? requestedType
    : 'article'

  return (
    <main className="py-8">
      <div className="text-center">
        <h1 className="text-5xl">For Human Creativity</h1>
        <Divider animate />
      </div>
      <nav aria-label="Publication type" className="mb-5 flex gap-5 border-b">
        {tabs.map((tab) => (
          <Link
            key={tab.type}
            href={tab.href}
            aria-current={tab.type === type ? 'page' : undefined}
            className={`border-b-2 px-1 py-3 text-sm ${
              tab.type === type
                ? 'border-blurple font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <LatestPublications key={type} type={type} pageSize={20} showHeading={false} />
    </main>
  )
}

export default Page
