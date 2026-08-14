import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AuthorsManager } from '@/components/AuthorsManager'
import { getAuthenticatedUser } from '@/lib/auth-user'

async function AuthorsContent() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  return <AuthorsManager />
}

export default function AuthorsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AuthorsContent />
    </Suspense>
  )
}
