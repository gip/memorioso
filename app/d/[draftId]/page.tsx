import { Draft } from '@/components/Draft'

const Page = async ({ params }: { params: Promise<{ draftId: string }> }) => {

  const resolvedParams = await params
  const draftIdParam: string | null = !resolvedParams.draftId || resolvedParams.draftId === 'new' ? null : resolvedParams.draftId

  return <Draft draftId={draftIdParam} />
}

export default Page
