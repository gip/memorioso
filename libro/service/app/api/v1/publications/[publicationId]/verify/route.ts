import { verifyLibroManifestOnChain } from '@libro/core'
import { chainConfig } from '@/lib/chain'
import { errorResponse } from '@/lib/errors'
import { publicationManifest } from '@/lib/imports'
import { getPublication } from '@/lib/publications'

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }): Promise<Response> {
  try {
    const { publicationId } = await context.params
    const publication = await getPublication(publicationId)
    if (!publication) return Response.json({ error: { code: 'NOT_FOUND', message: 'Publication not found', retryable: false } }, { status: 404 })
    const verification = await verifyLibroManifestOnChain(publicationManifest(publication), chainConfig().rpcUrls)
    return Response.json({
      publicationId,
      signalHash: publication.signalHash,
      verified: true,
      verifiedBy: verification.verifiedBy,
      outcomes: verification.outcomes,
    }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' } })
  } catch (error) {
    return errorResponse(error)
  }
}
