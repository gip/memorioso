import { cookies } from "next/headers"

export const insecureGetUser = async () => {
  const cookieStore = await cookies()
  const body = cookieStore.get('insecure-session')
  const session = JSON.parse(body?.value || '{}')
  console.log('SES', session)
  if (session && session.status && session.user && session.user.walletAddress) {
    return session.user
  }
  return null
}
