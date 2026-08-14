import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Author } from '@/components/Author'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getAuthorByHandle, getPublicationInfoByAuthor } from '@/lib/db/objects'
import { isValidUserHandle } from '@/lib/handle'

type Params = Promise<{ authorHandle: string }>

async function resolveAuthor(value: string) {
  if (!value.startsWith('@')) return null
  const handle = value.slice(1)
  if (!isValidUserHandle(handle)) return null
  return getAuthorByHandle(handle)
}

export const generateMetadata = async ({ params }: { params: Params }): Promise<Metadata> => {
  const { authorHandle } = await params
  const author = await resolveAuthor(authorHandle)
  if (!author) return {}
  const url = `https://memorioso.xyz/@${author.handle}`
  return {
    title: `${author.name} (@${author.handle})`,
    description: author.bio || `Publications by ${author.name} on Memorioso.`,
    alternates: { canonical: url },
    openGraph: {
      title: `${author.name} (@${author.handle})`,
      description: author.bio || `Publications by ${author.name} on Memorioso.`,
      url,
      type: 'profile',
    },
  }
}

export default async function Page({ params }: { params: Params }) {
  const { authorHandle } = await params
  const author = await resolveAuthor(authorHandle)
  if (!author) notFound()
  const [publicationInfos, authenticatedUser] = await Promise.all([
    getPublicationInfoByAuthor(author.id),
    getAuthenticatedUser(),
  ])
  const self = Boolean(authenticatedUser && author.userId === authenticatedUser.id)
  return <Author author={author} publicationInfos={publicationInfos} self={self} />
}
