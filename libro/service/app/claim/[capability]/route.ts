import { browserUrl } from '@/lib/config'

// Keep already-issued signing links recoverable without serving a frontend.
export async function GET(_request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  const { capability } = await context.params
  return Response.redirect(browserUrl(`/claim/${encodeURIComponent(capability)}`))
}
