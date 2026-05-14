import { Header } from '@/components/Header'
import { getAuthors } from '@/lib/db/objects'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { Footer } from '@/components/Footer'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const Info = async () => {
  const user = await getAuthenticatedUser()
  const name = user?.subject
  const authors = name && await getAuthors(name)

  return (<>
    <Header />
    <div className="max-w-3xl mx-auto py-12 px-4">
      {name ? (
        <>
          <h2 className="text-2xl font-bold">User Information</h2>
          <p className="mt-4 text-xs bg-gray-200 p-2 break-all text-center rounded-xl">
            {name}
          </p>
          <p className="mt-2 text-sm text-gray-500 p-4">
            This unique ID is the only information we store about you.
            It is application-specific and cannot be traced.
          </p>
          <h2 className="text-2xl font-bold">Authorship</h2>
          {authors && authors.length > 0 ? (
            authors.map((author) => (
              <div className="px-4 py-2" key={author.id}>
                <h3 className="text-lg font-bold">
                  <Link href={`/a/${author.id}`}>{author.name}</Link>
                </h3>
                <p className="text-sm text-gray-500">{author.bio}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 px-4 py-2">
              You have not created any authors yet.
            </p>
          )}
        </>
      ) : (
        <p className="text-center text-gray-500">
          Please log in to see your information
        </p>
      )}
      <Footer />
    </div>
  </>);
}

export default Info
