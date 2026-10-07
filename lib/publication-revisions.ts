import { readLibroRevisionStatus, normalizeUint256Hex, type LibroPublicationReference, type LibroRevisionInfo } from '@libro/core'
import { pool } from '@/lib/db'
import { getPublication, getProof, mapPublicationRow } from '@/lib/db/objects'
import { libroServiceReadsEnabled, getServicePublication } from '@/lib/libro-service/client'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getPublicationKind } from '@/lib/publication-kind'
import { buildLibroEmbedManifest } from '@/lib/libro/embed'

export class PublicationRevisionError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}
export async function getPublicationRevision(publicationId: string, database?: import('pg').PoolClient): Promise<LibroRevisionInfo | null> {
  if (libroServiceReadsEnabled() && !database) return (await getServicePublication(publicationId))?.revision ?? null
  const db = database || pool
  const row = (await db.query('SELECT id, root_publication_id, previous_publication_id, initially_published_at, date, revision_number FROM publications WHERE id = $1', [publicationId])).rows[0]
  if (!row) return null
  const head = (await db.query('SELECT id FROM publications WHERE COALESCE(root_publication_id,id) = $1 ORDER BY revision_number DESC LIMIT 1', [row.root_publication_id || row.id])).rows[0]
  return { rootPublicationId: String(row.root_publication_id || row.id), previousPublicationId: row.previous_publication_id == null ? null : String(row.previous_publication_id), latestPublicationId: String(head?.id || row.id), initiallyPublishedAt: new Date(row.initially_published_at || row.date).toISOString(), revisionNumber: row.revision_number || 1, isLatest: String(head?.id || row.id) === publicationId }
}
export async function getPublicationVersionStatus(publicationId: string, database?: import('pg').PoolClient) {
  const local = database ? (await database.query('SELECT signal, version, proof FROM publications WHERE id = $1', [publicationId])).rows[0] : null
  const publication = database ? local ? mapPublicationRow(local) : null : await getPublication(publicationId)
  const proof = database ? local?.proof : await getProof(publicationId)
  if (!publication || !proof) throw new PublicationRevisionError('Publication not found', 404)
  const manifest = buildLibroEmbedManifest(publication, proof, publicationId)
  const reference: LibroPublicationReference = { chain_id: 480, registry_address: manifest.registration.registry_address, signal_hash: manifest.registration.signal_hash }
  const status = await readLibroRevisionStatus(reference, process.env.LIBRO_RPC_URL)
  if (!status.exists) throw new PublicationRevisionError('Publication registration is unavailable', 422)
  const info = await getPublicationRevision(publicationId, database)
  if (!info) throw new PublicationRevisionError('Publication not found', 404)
  const latestHash = normalizeUint256Hex(String(status.latest.signalHash), 'signal_hash')
  let latestId: string | null = null
  if (libroServiceReadsEnabled() && !database) {
    // The canonical service can know a finalized head before its local webhook arrives.
    const { getServicePublicationBySignal } = await import('@/lib/libro-service/client')
    latestId = (await getServicePublicationBySignal(latestHash))?.id ?? null
  } else {
    latestId = (await (database || pool).query("SELECT id FROM publications WHERE LOWER(COALESCE(proof->>'signal_hash', proof->'agent_document_signature'->>'document_signal_hash')) = $1", [latestHash])).rows[0]?.id?.toString() ?? null
  }
  return { ...info, isLatest: status.isLatest, latestPublicationId: latestId, pending: !latestId,
    latestReference: { chain_id: 480 as const, registry_address: status.latest.registry, signal_hash: latestHash } }
}
export async function getRevisionSource(publicationId: string, expectedUserId?: number) {
  const user = await getAuthenticatedUser()
  if (!user || expectedUserId !== undefined && user.id !== expectedUserId) throw new PublicationRevisionError('Authentication required', 401)
  const publication = await getPublication(publicationId)
  if (!publication) throw new PublicationRevisionError('Publication not found', 404)
  const handle = publication.author_handle_libro
  const author = (await pool.query('SELECT id FROM authors WHERE handle = $1 AND "userId" = $2', [handle, user.id])).rows[0]
  if (!author) throw new PublicationRevisionError('This publication belongs to another author', 403)
  const status = await getPublicationVersionStatus(publicationId)
  if (!status.isLatest) throw new PublicationRevisionError('A newer version exists. Start from the latest publication; your draft is preserved.')
  const proof = await getProof(publicationId)
  const manifest = buildLibroEmbedManifest(publication, proof, publicationId)
  const policy = (await pool.query(libroServiceReadsEnabled() ? 'SELECT access, access_price_usd FROM publication_policies WHERE publication_id = $1' : 'SELECT access, access_price_usd FROM publications WHERE id = $1', [publicationId])).rows[0]
  return {
    previousPublicationId: publicationId,
    previousPublication: { chain_id: 480 as const, registry_address: manifest.registration.registry_address, signal_hash: manifest.registration.signal_hash },
    initiallyPublishedAt: status.initiallyPublishedAt,
    revisionNumber: status.revisionNumber + 1,
    draft: { title: publication.publication_title, subtitle: publication.publication_subtitle || '', content: publication.publication_content, authorId: String(author.id), publicationType: getPublicationKind(publication), access: policy?.access || 'public', previousPublicationId: publicationId },
    priceUsd: policy?.access_price_usd ?? null,
  }
}
export async function getPublicationVersions(publicationId: string) {
  if (libroServiceReadsEnabled()) {
    const { getServicePublicationVersions } = await import('@/lib/libro-service/client')
    return (await getServicePublicationVersions(publicationId)).versions
  }
  const info = await getPublicationRevision(publicationId)
  if (!info) return []
  return (await pool.query('SELECT id, title, date, revision_number FROM publications WHERE COALESCE(root_publication_id,id) = $1 ORDER BY revision_number DESC', [info.rootPublicationId])).rows.map(row => ({ publicationId: String(row.id), revisionNumber: row.revision_number, publicationDate: new Date(row.date).toISOString(), publicationType: row.title.trim() ? 'article' as const : 'short' as const }))
}

export async function validateLocalPublicationRevision(publication: import('@libro/core').LibroPublicationPayload, authorId: string, agent = false, database: Pick<import('pg').PoolClient, 'query'> = pool) {
  const { isV2Publication, registryProtocolVersion } = await import('@libro/core')
  if (!isV2Publication(publication) || registryProtocolVersion(publication.publication_registry) !== 'libro-v2') throw new PublicationRevisionError('New publications must use the configured Libro v2 registry', 400)
  if (!publication.previous_publication) return
  const previous = (await database.query(`SELECT id, "authorId", signal, proof, initially_published_at, date, revision_number FROM publications
    WHERE LOWER(COALESCE(proof->>'signal_hash',proof->'agent_document_signature'->>'document_signal_hash')) = $1`, [publication.previous_publication.signal_hash.toLowerCase()])).rows[0]
  if (!previous) throw new PublicationRevisionError('Previous publication is unavailable', 404)
  const manifest = buildLibroEmbedManifest(previous.signal, previous.proof, String(previous.id))
  if (String(previous.authorId) !== authorId || manifest.registration.registry_address !== publication.previous_publication.registry_address.toLowerCase()
    || previous.signal.author_handle_hash_libro !== publication.author_handle_hash_libro) throw new PublicationRevisionError('Previous publication belongs to another author or registry', 403)
  if (agent && manifest.registration.authorship_class !== 'agent') throw new PublicationRevisionError('Agents may only update agent publications', 403)
  if (getPublicationKind(previous.signal) !== getPublicationKind(publication)) throw new PublicationRevisionError('An update must keep the publication type', 400)
  if (Date.parse(publication.initially_published_at) !== new Date(previous.initially_published_at || previous.date).getTime() || publication.revision_number !== previous.revision_number + 1) throw new PublicationRevisionError('Update date or version does not match the previous publication', 400)
  const status = await readLibroRevisionStatus(publication.previous_publication, process.env.LIBRO_RPC_URL)
  if (!status.exists || !status.isLatest) throw new PublicationRevisionError('A newer version exists. Restart from the latest version; your draft is preserved.')
}

export async function persistLocalPublicationRevision(client: import('pg').PoolClient, publicationId: string, publication: import('@libro/core').LibroPublicationPayload) {
  const { isV2Publication } = await import('@libro/core')
  let rootId = publicationId
  let previousId: string | null = null
  if (isV2Publication(publication) && publication.previous_publication) {
    const previous = (await client.query(`SELECT * FROM publications WHERE LOWER(COALESCE(proof->>'signal_hash',proof->'agent_document_signature'->>'document_signal_hash')) = $1 FOR UPDATE`, [publication.previous_publication.signal_hash.toLowerCase()])).rows[0]
    if (!previous) throw new PublicationRevisionError('Previous version has not finalized', 409)
    if (previous.signal.author_handle_hash_libro !== publication.author_handle_hash_libro || getPublicationKind(previous.signal) !== getPublicationKind(publication) || Date.parse(publication.initially_published_at) !== new Date(previous.initially_published_at || previous.date).getTime() || publication.revision_number !== previous.revision_number + 1) throw new PublicationRevisionError('Frozen update metadata does not match its predecessor', 400)
    previousId = String(previous.id); rootId = String(previous.root_publication_id || previous.id)
  }
  await client.query('UPDATE publications SET root_publication_id = $2, previous_publication_id = $3, initially_published_at = $4, revision_number = $5 WHERE id = $1',
    [publicationId, rootId, previousId, isV2Publication(publication) ? publication.initially_published_at : publication.publication_date, isV2Publication(publication) ? publication.revision_number : 1])
  await client.query('UPDATE publication_policies SET root_publication_id = $2, previous_publication_id = $3, initially_published_at = $4, revision_number = $5 WHERE publication_id = $1', [publicationId, rootId, previousId, isV2Publication(publication) ? publication.initially_published_at : publication.publication_date, isV2Publication(publication) ? publication.revision_number : 1])
  return [...new Set([publicationId, ...(await client.query('SELECT id FROM publications WHERE root_publication_id = $1', [rootId])).rows.map(row => String(row.id))])]
}
