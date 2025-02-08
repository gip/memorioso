import { cookies } from "next/headers"

export const insecureGetSession = async () => {
  const cookieStore = await cookies()
  const body = cookieStore.get('insecure-session')
  const session = JSON.parse(body?.value || '{}')
  if (session && session.status && session.address) {
    return session
  }
  return null
}
