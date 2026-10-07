import { NextResponse } from 'next/server'
import { getRevisionSource, PublicationRevisionError } from '@/lib/publication-revisions'

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }) {
  const { publicationId } = await context.params
  try { return NextResponse.json(await getRevisionSource(publicationId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : 'Could not start a revision' }, { status: error instanceof PublicationRevisionError ? error.status : 503 }) }
}
