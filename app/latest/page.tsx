import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { getLatestPublications } from '@/lib/db/objects'
import { Card, CardContent } from "@/components/ui/card"
import Link from 'next/link'
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
        <Divider animate={false} />
      </div>
      <div className="w-[90%] mx-auto">
        <main className="w-full">
          <div className="text-left p-4 flex items-start gap-2">
            <h2 className="text-2xl font-bold">Latest Publications</h2>
          </div>
          <div className="space-y-6 py-4">
            {publications.map(publication => (
              <Link href={`/p/${publication.id}`} key={publication.id}>
                <Card className="shadow-sm w-full cursor-pointer my-4">
                  <CardContent className="py-2 px-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-medium line-clamp-1">
                        {publication.publication_title}
                      </div>
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {publication.publication_subtitle && (
                          <div className="flex items-center gap-2">
                            <span className="line-clamp-1">{publication.publication_subtitle}</span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground italic text-right">
                          Published {timeAgo(publication.publication_date)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </main>
      </div>
      <Footer />
    </>
  )
}

export default Page 
