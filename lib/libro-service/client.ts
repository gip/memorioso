import type { LibroPublicationRecord, LibroPublicationSummary } from '@libro/core'
import type { PublicationInfo, PublicationRecord, Proof } from '@/types'
import type { PublicationFeedKind, PublicationKind } from '@/lib/publication-kind'
import { getLibroAccessToken } from './token-store'

type ErrorEnvelope = { error?: { code: string; message: string; retryable: boolean } }

export class LibroServiceUnavailableError extends Error {}

export function libroServiceReadsEnabled(): boolean {
  return process.env.LIBRO_SERVICE_READS_ENABLED === '1'
}

function config() {
  const url = process.env.LIBRO_SERVICE_URL
  const clientId = process.env.LIBRO_OAUTH_CLIENT_ID
  const secret = process.env.LIBRO_OAUTH_CLIENT_SECRET
  if (!url || !clientId || !secret) throw new LibroServiceUnavailableError('Libro service configuration is incomplete')
  return { url: new URL(url).origin, clientId, authorization: `Service ${clientId}.${secret}` }
}

async function jsonRequest<T>(path: string, serviceAuth = false): Promise<T> {
  const value = config()
  let response: Response
  try {
    response = await fetch(new URL(path, value.url), {
      headers: serviceAuth ? { Authorization: value.authorization } : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new LibroServiceUnavailableError('Libro service could not be reached')
  }
  const body = await response.json().catch(() => null) as (T & ErrorEnvelope) | null
  if (!response.ok || !body) throw new LibroServiceUnavailableError(body?.error?.message || `Libro service returned HTTP ${response.status}`)
  return body
}

async function recordRequest(path: string): Promise<LibroPublicationRecord | null> {
  const value = config()
  let response: Response
  try {
    response = await fetch(new URL(path, value.url), { cache: 'no-store' })
  } catch {
    throw new LibroServiceUnavailableError('Libro service could not be reached')
  }
  if (response.status === 404) return null
  const body = await response.json().catch(() => null) as ({ publication?: LibroPublicationRecord } & ErrorEnvelope) | null
  if (!response.ok || !body?.publication) throw new LibroServiceUnavailableError(body?.error?.message || `Libro service returned HTTP ${response.status}`)
  return body.publication
}

export function getServicePublication(id: string): Promise<LibroPublicationRecord | null> {
  return recordRequest(`/api/v1/publications/${encodeURIComponent(id)}`)
}

export function getServicePublicationBySignal(signalHash: string): Promise<LibroPublicationRecord | null> {
  return recordRequest(`/api/v1/publications/by-signal/${encodeURIComponent(signalHash)}`)
}

export function serviceRecordToPublication(value: LibroPublicationRecord): PublicationRecord {
  return { ...(value.signal as PublicationRecord), version: value.version }
}

export function serviceRecordProof(value: LibroPublicationRecord): Proof {
  return value.proof as Proof
}

export async function listServicePublications(input: {
  limit: number
  offset: number
  authorId?: string
  kind: PublicationFeedKind
}): Promise<LibroPublicationSummary[]> {
  const value = config()
  const query = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
    kind: input.kind,
    originClientId: value.clientId,
  })
  if (input.authorId) query.set('authorId', input.authorId)
  const result = await jsonRequest<{ publications: LibroPublicationSummary[] }>(`/api/v1/publications?${query}`, true)
  return result.publications
}

export function getServiceAuthorCounts(authorId: string): Promise<{ article: number; short: number }> {
  return jsonRequest(`/api/v1/publications/counts?authorId=${encodeURIComponent(authorId)}`, true)
}

export async function getServiceSitemapPublications(limit: number): Promise<Array<{ id: string; kind: PublicationKind; lastModified: string }>> {
  const result = await jsonRequest<{ publications: Array<{ id: string; kind: PublicationKind; lastModified: string }> }>(
    `/api/v1/publications/sitemap?limit=${limit}`,
    true,
  )
  return result.publications
}

export function serviceSummaryToPublicationInfo(summary: LibroPublicationSummary, access: 'public' | 'gated'): PublicationInfo {
  return {
    id: summary.id,
    author_id_libro: summary.authorId,
    publication_date: summary.publicationDate,
    author_name_libro: summary.authorName,
    publication_title: summary.title,
    publication_subtitle: summary.subtitle,
    publication_excerpt: summary.excerpt,
    access,
    authorship_label: summary.authorshipClass === 'agent' ? 'Human-authorized agent' : 'Signed by a human',
    publication_type: summary.publicationType,
  }
}

export async function createServiceHumanPublication(input: {
  userId: number
  publication: unknown
  clientReference: string
}): Promise<{ challengeId: string; signalHash: string; signingUrl: string }> {
  const value = config()
  const token = await getLibroAccessToken(input.userId, 'publish')
  const response = await fetch(new URL('/api/v1/human-publications', value.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ publication: input.publication, clientReference: input.clientReference }),
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as {
    challengeId?: string; signalHash?: string; signingUrl?: string; error?: { message?: string }
  } | null
  if (!response.ok || !body?.challengeId || !body.signalHash || !body.signingUrl) {
    throw new LibroServiceUnavailableError(body?.error?.message || 'Libro publication challenge failed')
  }
  return body as { challengeId: string; signalHash: string; signingUrl: string }
}

export async function getServiceHumanPublicationStatus(input: {
  userId: number
  challengeId: string
}): Promise<{ state: string; signalHash: string; publicationId: string | null; transactionHash: string | null }> {
  const value = config()
  const token = await getLibroAccessToken(input.userId)
  const response = await fetch(new URL(`/api/v1/human-publications/${encodeURIComponent(input.challengeId)}`, value.url), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as {
    state?: string; signalHash?: string; publicationId?: string | null; transactionHash?: string | null; error?: { message?: string }
  } | null
  if (!response.ok || !body?.state || !body.signalHash) throw new LibroServiceUnavailableError(body?.error?.message || 'Libro publication status failed')
  return body as { state: string; signalHash: string; publicationId: string | null; transactionHash: string | null }
}
