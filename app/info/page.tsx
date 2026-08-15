import { getAuthors } from '@/lib/db/objects'
import { getAuthenticatedUser } from '@/lib/auth-user'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

const InfoContent = async () => {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  const name = user.subject
  const authors = await getAuthors(name)

  return (
    <main className="py-12">
      <h2 className="text-2xl font-bold">User Information</h2>
      <p className="mt-4 text-xs bg-gray-200 p-2 break-all text-center rounded-xl">
        {name}
      </p>
      <p className="mt-2 text-sm text-gray-500 p-4">
        This unique ID is the only information we store about you.
        It is application-specific and cannot be traced.
      </p>
      <h2 className="text-2xl font-bold">Authorship</h2>
      {authors.length > 0 ? (
        authors.map((author) => (
          <div className="px-4 py-2" key={author.id}>
            <h3 className="text-lg font-bold">
              <Link href={`/@${author.handle}`}>{author.name}</Link>
            </h3>
            <p className="text-sm text-gray-500">{author.bio}</p>
          </div>
        ))
      ) : (
        <p className="text-sm text-gray-500 px-4 py-2">
          You have not created any authors yet.
        </p>
      )}
    </main>
  );
}

const Info = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <InfoContent />
  </Suspense>
)

export default Info
