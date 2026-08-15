import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Profile } from '@/components/Profile'
import { getAuthenticatedUser } from '@/lib/auth-user'

async function ProfileContent() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  return <Profile subject={user.subject} />
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ProfileContent />
    </Suspense>
  )
}
