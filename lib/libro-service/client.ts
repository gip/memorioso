import { createLibroMcpClient, LibroMcpError } from '@libro/core'
import type { LibroPublicationRecord, LibroPublicationSummary } from '@libro/core'
import type { PublicationInfo, PublicationRecord, Proof } from '@/types'
import type { PublicationFeedKind } from '@/lib/publication-kind'
import { getLibroAccessToken } from './token-store'

export class LibroServiceUnavailableError extends Error {
  constructor(message: string, public readonly status = 502, public readonly code = 'LIBRO_SERVICE_UNAVAILABLE') {
    super(message)
    this.name = 'LibroServiceUnavailableError'
  }
}

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

async function toolRequest<T>(name: string, args: Record<string, unknown> = {}, authorization?: string): Promise<T> {
  const value = config()
  try {
    return await createLibroMcpClient(new URL('/mcp', value.url).toString(), {
      headers: authorization ? { Authorization: authorization } : undefined,
    }).callTool<T>(name, args)
  } catch (error) {
    if (error instanceof LibroMcpError) throw new LibroServiceUnavailableError(error.message, error.status, error.code)
    throw new LibroServiceUnavailableError('Libro service could not be reached')
  }
}

async function recordRequest(name: string, args: Record<string, unknown>): Promise<LibroPublicationRecord | null> {
  try { return await toolRequest<LibroPublicationRecord>(name, args) }
  catch (error) {
    if (error instanceof LibroServiceUnavailableError && error.code === 'NOT_FOUND') return null
    throw error
  }
}

export function getServicePublication(id: string): Promise<LibroPublicationRecord | null> {
  return recordRequest('get_publication', { publicationId: id })
}

export function getServicePublicationBySignal(signalHash: string): Promise<LibroPublicationRecord | null> {
  return recordRequest('get_publication_by_signal', { signalHash })
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
  return toolRequest('list_publications', { ...input, originClientId: value.clientId }, value.authorization)
}

export function getServiceAuthorCounts(authorId: string): Promise<{ article: number; short: number }> {
  return toolRequest('publication_counts', { authorId }, config().authorization)
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
  const result = await serviceUserRequest<{ challengeId: string; signalHash: string; signingUrl: string }>(input.userId, 'publish', 'create_human_publication', {
    publication: input.publication, clientReference: input.clientReference,
  })
  if (!result?.challengeId || !result.signalHash || !result.signingUrl) throw new LibroServiceUnavailableError('Libro publication challenge failed')
  return result
}

export async function getServiceHumanPublicationStatus(input: {
  userId: number
  challengeId: string
}): Promise<{ state: string; signalHash: string; publicationId: string | null; transactionHash: string | null }> {
  return serviceUserRequest(input.userId, undefined, 'publication_status', { challengeId: input.challengeId })
}

export async function serviceUserRequest<T>(userId: number, scope: string | undefined, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = await getLibroAccessToken(userId, scope)
  return toolRequest<T>(name, args, `Bearer ${token}`)
}
