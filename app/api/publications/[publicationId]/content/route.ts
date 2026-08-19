import { NextRequest, NextResponse } from 'next/server'
import { getCachedProof, getCachedPublication, getCachedPublicationAccess } from '@/lib/db/publication-cache'
import { buildLibroEmbedManifest, LibroEmbedUnavailableError } from '@/lib/libro/embed'
import { publicationContentPath } from '@/lib/publication-kind'
import { effectivePriceUsd, resolvePublicationAccess } from '@/lib/access/publication-access'
import {
  ACCESS_TOKEN_HEADER,
  accessCookieName,
  completeAccessGrant,
  failAccessGrant,
  refreshTokenForSettledPayer,
  reserveAccessGrant,
} from '@/lib/access/grants'
import { X402_NETWORK, X402_SCHEME } from '@/lib/access/config'
import { buildPaymentRequirements, encodeSettlementHeader, paymentRequiredBody } from '@/lib/x402/requirements'
import { decodePaymentHeader, verifyPayment } from '@/lib/x402/verify'
import { settlePayment } from '@/lib/x402/settle'
import type { PaymentRequirements } from '@/lib/x402/types'
import type { PublicationRecord } from '@/types'

type Params = Promise<{ publicationId: string }>

const PAYMENT_HEADER = 'x-payment'
const MAX_PAYMENT_HEADER_BYTES = 8192

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
}

/** Never cacheable: the same URL answers differently per caller. */
const BASE_HEADERS = { ...CORS_HEADERS, 'Cache-Control': 'no-store' }

function contentResource(request: NextRequest, publicationId: string): string {
  return new URL(publicationContentPath(publicationId), request.nextUrl.origin).toString()
}

function describe(publication: PublicationRecord): string {
  const title = publication.publication_title.trim()
  return title
    ? `Full text of "${title}" by @${publication.author_handle_libro} on Memorioso`
    : `Full text of a short by @${publication.author_handle_libro} on Memorioso`
}

async function grantedResponse(
  publicationId: string,
  publication: PublicationRecord,
  extra: { token?: string; settlement?: Record<string, unknown> } = {}
): Promise<NextResponse> {
  const proof = await getCachedProof(publicationId)
  let manifest = null
  try {
    manifest = buildLibroEmbedManifest(publication, proof, publicationId)
  } catch (error) {
    if (!(error instanceof LibroEmbedUnavailableError)) throw error
  }

  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (extra.settlement) {
    headers['X-PAYMENT-RESPONSE'] = encodeSettlementHeader(extra.settlement)
  }

  const response = NextResponse.json({
    success: true,
    publication,
    proof,
    manifest,
    ...(extra.token
      ? { access: { token: extra.token, header: ACCESS_TOKEN_HEADER } }
      : {}),
  }, { headers })

  if (extra.token) {
    response.cookies.set(accessCookieName(publicationId), extra.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
  }

  return response
}

function paymentRequired(requirements: PaymentRequirements, error: string): NextResponse {
  return NextResponse.json(paymentRequiredBody(requirements, error), {
    status: 402,
    headers: BASE_HEADERS,
  })
}

export async function GET(request: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const { publicationId } = await params
  const publication = await getCachedPublication(publicationId)
  if (!publication) {
    return NextResponse.json({ success: false, message: 'Publication not found' }, {
      status: 404,
      headers: BASE_HEADERS,
    })
  }

  const decision = await resolvePublicationAccess(publicationId, request)
  if (decision.allowed) {
    return grantedResponse(publicationId, publication)
  }

  const access = await getCachedPublicationAccess(publicationId)
  const priceUsd = effectivePriceUsd(access?.priceUsd)
  if (priceUsd === null) {
    // No payment env here, so there are no requirements to quote. 403 rather than a
    // 402 the caller could never satisfy.
    return NextResponse.json({
      success: false,
      message: 'This publication is gated. Sign in with World ID on Memorioso to read it; '
        + 'this deployment does not accept x402 payments.',
    }, { status: 403, headers: BASE_HEADERS })
  }

  const requirements = buildPaymentRequirements({
    resource: contentResource(request, publicationId),
    description: describe(publication),
    priceUsd,
  })

  const header = request.headers.get(PAYMENT_HEADER)
  if (!header) {
    return paymentRequired(requirements, 'X-PAYMENT header is required')
  }
  if (Buffer.byteLength(header, 'utf8') > MAX_PAYMENT_HEADER_BYTES) {
    return paymentRequired(requirements, 'X-PAYMENT header is too large')
  }

  const payload = decodePaymentHeader(header)
  if (!payload) {
    return paymentRequired(requirements, 'X-PAYMENT header is not base64-encoded JSON')
  }

  const verification = await verifyPayment(payload, requirements)
  if (!verification.ok) {
    return paymentRequired(requirements, verification.reason)
  }

  // A payer who already holds a grant is never charged twice.
  const existingToken = await refreshTokenForSettledPayer(publicationId, verification.payer)
  if (existingToken) {
    return grantedResponse(publicationId, publication, { token: existingToken })
  }

  // Claim the nonce before broadcasting, so a crash mid-settlement cannot take the
  // money without recording the grant, and a replay cannot reach the chain twice.
  const reservation = await reserveAccessGrant({
    publicationId,
    payerAddress: verification.payer,
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    assetAddress: requirements.asset,
    amount: verification.amount,
    validBefore: verification.validBefore,
    authorizationNonce: payload.payload.authorization.nonce,
  })

  if (!reservation) {
    return paymentRequired(requirements, 'Authorization nonce has already been used')
  }

  let transactionHash: string
  try {
    transactionHash = await settlePayment(payload)
  } catch (error) {
    await failAccessGrant(reservation.grantId)
    return NextResponse.json(
      paymentRequiredBody(
        requirements,
        error instanceof Error ? error.message : 'Settlement failed'
      ),
      {
        status: 402,
        headers: {
          ...BASE_HEADERS,
          'X-PAYMENT-RESPONSE': encodeSettlementHeader({
            success: false,
            errorReason: 'settlement_failed',
            transaction: '',
            network: X402_NETWORK,
            payer: verification.payer,
          }),
        },
      }
    )
  }

  await completeAccessGrant(reservation.grantId, transactionHash)

  return grantedResponse(publicationId, publication, {
    token: reservation.token,
    settlement: {
      success: true,
      transaction: transactionHash,
      network: X402_NETWORK,
      payer: verification.payer,
    },
  })
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': `Content-Type, X-PAYMENT, ${ACCESS_TOKEN_HEADER}`,
      'Access-Control-Max-Age': '86400',
    },
  })
}
