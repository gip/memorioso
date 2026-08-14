import { redirect } from 'next/navigation'

import { Activity } from '@/components/Activity'
import { getAuthenticatedUser } from '@/lib/auth-user'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  return <Activity />
}
