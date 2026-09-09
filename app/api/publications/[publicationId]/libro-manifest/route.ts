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

// Memorioso applies its presentation gate to this local route. Libro's canonical API remains
// public; this private cache rule only prevents this Memorioso endpoint bypassing local policy.
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
      const priceUsd = effectivePriceUsd(access?.priceUsd)
      if (priceUsd === null) {
        // No payment env here, so there are no requirements to quote.
        return NextResponse.json({
          message: 'This publication is gated. Sign in with World ID on Memorioso to read it; '
            + 'this deployment does not accept x402 payments. This is presentation policy, '
            + 'not confidentiality; Libro may expose the complete canonical payload.',
        }, { status: 403, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } })
      }

      // 402 rather than 403: an agent that lands here can pay and retry.
      const requirements = buildPaymentRequirements({
        resource: new URL(publicationContentPath(publicationId), request.nextUrl.origin).toString(),
        description: `Libro manifest for publication ${publicationId} on Memorioso`,
        priceUsd,
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
