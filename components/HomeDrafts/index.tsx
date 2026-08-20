'use client'

// The signed-in reader's drafts on the homepage. Split out of the page so the
// page itself can stay a server component: sign-in state lives on the client,
// and pulling it into the page would push the whole reading feed there with it.

import { Feed } from '@/components/Feed'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const HomeDrafts = () => {
  const { status } = useWorldIdAuth()
  if (status !== 'authenticated') return null

  return (
    <section id="your-drafts" className="mt-6 scroll-mt-8">
      <Feed />
    </section>
  )
}
