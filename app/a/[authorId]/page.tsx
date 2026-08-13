import { Author } from '@/components/Author'
import { type Author as AuthorType, getAuthor, getPublicationInfoByAuthor, getAuthorByHandle } from '@/lib/db/objects'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { notFound } from 'next/navigation'
import { Footer } from '@/components/Footer'

const Page = async ({ params }: { params: Promise<{ authorId: string }> }) => {
  const resolvedParams = await params
  const { authorId } = resolvedParams

  if (!authorId) {
    notFound()
  }

  let author: AuthorType | null = null
  let redirect: string | null = null
  // UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidRegex.test(authorId)) {
    author = await getAuthor(authorId)
    if (author && author.handle) {
      redirect = `/a/${author.handle}`
    }
  } else if (authorId.length <= 32) {
    author = await getAuthorByHandle(authorId)
  } else {
    notFound()
  }

  if (!author) {
    notFound()
  }

  const [publicationInfos, authenticatedUser] = await Promise.all([
    getPublicationInfoByAuthor(author.id),
    getAuthenticatedUser(),
  ])
  const self = Boolean(authenticatedUser && author.userId === authenticatedUser.id)

  return (<>
    <div className="w-[96%] mx-auto space-y-4 py-4">
      <Author author={author} publicationInfos={publicationInfos} redirect={redirect} self={self} />
    </div>
    <Footer />
  </>)
}

export default Page
