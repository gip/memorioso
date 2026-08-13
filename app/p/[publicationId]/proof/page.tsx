import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { Proof } from '@/components/Proof'
import { getProof, getPublication } from '@/lib/db/objects'
import { extractReadableText } from '@libro/core'

type Params = Promise<{ publicationId: string }>

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { publicationId } = await params
  const publication = await getPublication(publicationId)
  const title = publication?.publication_title.trim()
    || (publication ? extractReadableText(publication.publication_content.html) : '')

  return { title: `Proof · ${title}` }
}

const Page = async ({ params }: { params: Params }) => {

  const { publicationId } = await params
  const publication = await getPublication(publicationId)

  if (!publication) notFound()

  const proof = await getProof(publicationId)

  return <Proof proof={proof} publication={publication} publicationId={publicationId} />
}

export default Page
