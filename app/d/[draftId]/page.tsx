import { Draft } from '@/components/Draft'
import { isPublicationKind } from '@/lib/publication-kind'
import { Suspense } from 'react'

const DraftContent = async ({ params, searchParams }: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<{ type?: string }>
}) => {

  const resolvedParams = await params
  const draftIdParam: string | null = !resolvedParams.draftId || resolvedParams.draftId === 'new' ? null : resolvedParams.draftId

  const { type } = await searchParams
  const initialType = isPublicationKind(type) ? type : null

  return <Draft draftId={draftIdParam} initialType={initialType} />
}

const Page = ({ params, searchParams }: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<{ type?: string }>
}) => (
  <Suspense fallback={<div>Loading...</div>}>
    <DraftContent params={params} searchParams={searchParams} />
  </Suspense>
)

export default Page
