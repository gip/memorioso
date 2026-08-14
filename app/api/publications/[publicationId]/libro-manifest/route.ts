import { NextResponse } from 'next/server'
import { getCachedProof, getCachedPublication } from '@/lib/db/publication-cache'
import { buildLibroEmbedManifest, LibroEmbedUnavailableError } from '@/lib/libro/embed'

type Params = Promise<{ publicationId: string }>

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Type': 'application/libro+json; charset=utf-8',
}

export async function GET(_request: Request, { params }: { params: Params }): Promise<NextResponse> {
  const { publicationId } = await params
  const [publication, proof] = await Promise.all([
    getCachedPublication(publicationId),
    getCachedProof(publicationId),
  ])

  if (!publication) {
    return NextResponse.json({ message: 'Publication not found' }, {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const manifest = buildLibroEmbedManifest(publication, proof, publicationId)
    return new NextResponse(JSON.stringify(manifest), { status: 200, headers: PUBLIC_HEADERS })
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
