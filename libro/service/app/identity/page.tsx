import { IdentityClient } from './IdentityClient'

export const instant = false

export default async function IdentityPage({ searchParams }: { searchParams: Promise<{ continue?: string }> }) {
  const { continue: continueUrl = '/' } = await searchParams
  let safeContinue = '/'
  try {
    const parsed = new URL(continueUrl)
    const configuredOrigin = process.env.LIBRO_SERVICE_URL
      ? new URL(process.env.LIBRO_SERVICE_URL).origin
      : null
    if (configuredOrigin && parsed.origin === configuredOrigin) safeContinue = parsed.toString()
  } catch {
    // Relative or malformed continuation values fall back to the service home page.
  }
  return <main><IdentityClient continueUrl={safeContinue} /></main>
}
