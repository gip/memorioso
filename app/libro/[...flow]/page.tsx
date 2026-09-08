import { notFound } from 'next/navigation'
import { BrowserFlow } from '@/components/Libro/BrowserFlow'
import { IdentityClient } from '@/components/Libro/IdentityClient'

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

export const instant = false

export default async function LibroFlowPage({ params, searchParams }: {
  params: Promise<{ flow: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { flow } = await params
  const search = await searchParams
  const [kind, capability] = flow
  if (kind === 'identity' && flow.length === 1) {
    return <IdentityClient continueUrl={typeof search.continue === 'string' ? search.continue : '/'} />
  }
  if (!(kind === 'authorize' && flow.length === 1)
    && !(['sign', 'sign-agent', 'claim'].includes(kind) && flow.length === 2 && /^[A-Za-z0-9_-]+$/.test(capability))) notFound()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') query.set(key, value)
  }
  return <BrowserFlow kind={kind} capability={capability} query={query.toString()} />
}
