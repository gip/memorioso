import { NextRequest, NextResponse } from 'next/server'
import {
  getCachedProof,
  getCachedPublication,
  getCachedPublicationAccess,
} from '@/lib/db/publication-cache'
import { buildLibroEmbedManifest, LibroEmbedUnavailableError } from '@/lib/libro/embed'
import { publicationContentPath } from '@/lib/publication-kind'
import { effectivePriceUsd, resolvePublicationAccess } from '@/lib/access/publication-access'
import { buildPaymentRequirements, paymentRequiredBody } from '@/lib/x402/requirements'

type Params = Promise<{ publicationId: string }>

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Type': 'application/libro+json; charset=utf-8',
}

// A manifest embeds the whole signed publication, so a gated one must never be stored
// by a shared cache: one edge-cached hit would serve the body to everyone.
const GATED_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/libro+json; charset=utf-8',
}

export async function GET(request: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const { publicationId } = await params
  const [publication, proof, access] = await Promise.all([
    getCachedPublication(publicationId),
    getCachedProof(publicationId),
    getCachedPublicationAccess(publicationId),
  ])

  if (!publication) {
    return NextResponse.json({ message: 'Publication not found' }, {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  const isGated = access?.access === 'gated'
  if (isGated) {
    const decision = await resolvePublicationAccess(publicationId, request)
    if (!decision.allowed) {
      // 402 rather than 403: an agent that lands here can pay and retry.
      const requirements = buildPaymentRequirements({
        resource: new URL(publicationContentPath(publicationId), request.nextUrl.origin).toString(),
        description: `Libro manifest for publication ${publicationId} on Memorioso`,
        priceUsd: effectivePriceUsd(access?.priceUsd),
      })
      return NextResponse.json(
        paymentRequiredBody(requirements, 'This publication is gated'),
        { status: 402, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } }
      )
    }
  }

  try {
    const manifest = buildLibroEmbedManifest(publication, proof, publicationId)
    return new NextResponse(JSON.stringify(manifest), {
      status: 200,
      headers: isGated ? GATED_HEADERS : PUBLIC_HEADERS,
    })
  } catch (error) {
    const message = error instanceof LibroEmbedUnavailableError ? error.message : 'Libro embed is unavailable'
    return NextResponse.json({ message }, {
      status: 409,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, x-memorioso-access-token',
      'Access-Control-Max-Age': '86400',
    },
  })
}
