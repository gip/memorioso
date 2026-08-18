import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { Activity } from '@/components/Activity'
import { getAuthenticatedUser } from '@/lib/auth-user'

async function ActivityContent() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  return <Activity />
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ActivityContent />
    </Suspense>
  )
}
