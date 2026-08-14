import { Draft } from '@/components/Draft'
import { isPublicationKind } from '@/lib/publication-kind'

const Page = async ({ params, searchParams }: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<{ type?: string }>
}) => {

  const resolvedParams = await params
  const draftIdParam: string | null = !resolvedParams.draftId || resolvedParams.draftId === 'new' ? null : resolvedParams.draftId

  const { type } = await searchParams
  const initialType = isPublicationKind(type) ? type : null

  return <Draft draftId={draftIdParam} initialType={initialType} />
}

export default Page
