import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Proof } from '@/components/Proof'
import { getProof, getPublication } from '@/lib/db/objects'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  const publication = await getPublication(publicationId)

  return { title: `Proof · ${publication?.publication_title || 'Untitled publication'}` }
}

const Page = async ({ params }: { params: Params }) => {

  const { publicationId } = await params
  const publication = await getPublication(publicationId)

  if (!publication) notFound()

  const proof = await getProof(publicationId)

  return (<>
    <Header />
    <Proof proof={proof} publication={publication} publicationId={publicationId} />
    <Footer />
  </>)
}

export default Page
