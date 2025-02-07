'use client'

import { SessionProvider } from 'next-auth/react'
import { Home } from '@/components/Home'

export const Top = () => {
  return (
    <SessionProvider>
      <Home />
    </SessionProvider>
  )
}
