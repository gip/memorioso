import { redirect } from 'next/navigation'
import { AuthorsManager } from '@/components/AuthorsManager'
import { getAuthenticatedUser } from '@/lib/auth-user'

export default async function AuthorsPage() {
  const user = await getAuthenticatedUser()
  if (!user) redirect('/')

  return <AuthorsManager />
}
