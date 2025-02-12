import { cookies } from "next/headers"

export type User = {
  walletAddress: string
  username: string
  isHuman: boolean
}

export type Session = {
  user: User
}

export const insecureDeleteSession = async () => {
  const cookieStore = await cookies()
  cookieStore.delete('insecure-session')
}

export const insecureSetSession = async (session: Session | null) => {
  const cookieStore = await cookies()
  if (session) {
    cookieStore.set('insecure-session', JSON.stringify(session), {
      secure: true,
      httpOnly: true,
    })
  } else {
    cookieStore.delete('insecure-session')
  }
}

export const insecureGetSession = async (): Promise<Session | null> => {
  const cookieStore = await cookies()
  const body = cookieStore.get('insecure-session')
  const session = JSON.parse(body?.value || '{}')
  console.log('SES', session)
  if (session && session.status && session.user && session.user.walletAddress) {
    return session
  }
  return null
}
