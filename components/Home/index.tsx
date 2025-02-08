'use client'

import { useSession, signIn, signOut } from 'next-auth/react'

export const Home = () => {
  const { data: session } = useSession()

  return (
    <div>
      <h1>Home</h1>
      {!session && (
        <div>
          <button onClick={() => signIn('google')}>Sign in Google</button>
          <button onClick={() => signIn('worldcoin')}>Sign in World ID</button>
        </div>
      )}
      {session && <button onClick={() => signOut()}>Sign out</button>}
    </div>
  )
}