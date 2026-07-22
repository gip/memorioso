import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { getLatestPublications } from '@/lib/db/objects'
import { TextListCard } from '@/components/TextListCard'
import { timeAgo } from '@/lib/time'
import { Divider } from '@/components/Divider'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const publications = await getLatestPublications()

  return (
    <>
      <Header />
      <div className="text-center mt-4">
        <h1 className="text-5xl">
          For Human Creativity
        </h1>
        <Divider animate />
      </div>
      <div className="w-[90%] max-w-2xl mx-auto">
        <main className="w-full">
          <div className="text-left p-4 flex items-start gap-2">
            <h2 className="text-2xl font-bold">Latest Publications</h2>
          </div>
          <div className="space-y-3 py-4">
            {publications.map(publication => (
              <TextListCard
                key={publication.id}
                href={`/p/${publication.id}`}
                title={publication.publication_title}
                subtitle={publication.publication_subtitle}
                authorshipLabel={publication.authorship_label}
                metaText={`${publication.author_name_libro} · ${timeAgo(publication.publication_date)}`}
              />
            ))}
          </div>
        </main>
      </div>
      <Footer />
    </>
  )
}

export default Page 
