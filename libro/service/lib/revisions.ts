import { isV2Publication, registryProtocolVersion, readLibroRevisionStatus, normalizeUint256Hex, type LibroPublicationPayload, type LibroPublicationReference, type LibroRevisionInfo } from '@libro/core'
import { pool, type DatabaseClient } from './db'
import { ServiceError } from './errors'

export function publicationRegistration(row: Record<string, any>): LibroPublicationReference {
  const proof = row.proof
  const registration = proof?.manifest?.registration || proof?.libro_registration || proof?.agent_document_signature
  const address = row.registry_address || registration?.registry_address
  if (!address || !registryProtocolVersion(address)) throw new ServiceError('UNREGISTERED_PUBLICATION', 'This publication has no approved Libro registration', 422)
  return { chain_id: 480, registry_address: address.toLowerCase(), signal_hash: normalizeUint256Hex(row.signal_hash, 'signal_hash') }
}
export async function validatePublicationRevision(publication: LibroPublicationPayload, authorId: string, agent = false, database: Pick<DatabaseClient, 'query'> = pool) {
  if (!isV2Publication(publication)) throw new ServiceError('PROTOCOL_RETIRED', 'New publications must use Libro v2', 400)
  if (registryProtocolVersion(publication.publication_registry) !== 'libro-v2') throw new ServiceError('UNSUPPORTED_REGISTRY', 'Publication must target the configured v2 registry', 400)
  const reference = publication.previous_publication
  if (!reference) return
  const previous = (await database.query('SELECT * FROM libro_publications WHERE signal_hash = $1', [reference.signal_hash.toLowerCase()])).rows[0]
  if (!previous) throw new ServiceError('PREDECESSOR_NOT_FOUND', 'Previous publication is not available in Libro', 404)
  const registration = publicationRegistration(previous)
  if (registration.registry_address !== reference.registry_address.toLowerCase() || reference.chain_id !== 480) throw new ServiceError('PREDECESSOR_MISMATCH', 'Previous registry does not match the publication', 400)
  if (previous.author_id !== authorId || previous.signal.author_handle_hash_libro.toLowerCase() !== publication.author_handle_hash_libro.toLowerCase()) throw new ServiceError('AUTHOR_MISMATCH', 'Previous publication belongs to another author', 403)
  if (agent && previous.authorship_class !== 'agent') throw new ServiceError('AGENT_REVISION_FORBIDDEN', 'Agents may only revise agent publications', 403)
  if (Boolean(previous.title.trim()) !== Boolean(publication.publication_title.trim())) throw new ServiceError('PUBLICATION_KIND_MISMATCH', 'An update must keep the original publication type', 400)
  if (Date.parse(publication.initially_published_at) !== new Date(previous.initially_published_at || previous.date).getTime() || publication.revision_number !== previous.revision_number + 1) throw new ServiceError('REVISION_MISMATCH', 'Original publication date and revision number must match the predecessor', 400)
  const successor = await database.query('SELECT id FROM libro_publications WHERE previous_publication_id = $1', [previous.id])
  if (successor.rows.length) throw new ServiceError('REVISION_CONFLICT', 'A newer version exists. Restart from the latest publication; your draft is preserved.', 409)
  let status
  try { status = await readLibroRevisionStatus(reference, process.env.LIBRO_RPC_URL) }
  catch { throw new ServiceError('CHAIN_UNAVAILABLE', 'Could not confirm the latest publication version', 503, true) }
  if (!status.exists || !status.isLatest) throw new ServiceError('REVISION_CONFLICT', 'A newer version is already registered. Restart from the latest publication.', 409)
}
export async function persistRevisionProjection(client: DatabaseClient, publicationId: string, publication: LibroPublicationPayload) {
  let rootId = publicationId
  let previousId: string | null = null
  let initial = publication.publication_date
  let revision = 1
  if (isV2Publication(publication)) {
    initial = publication.initially_published_at
    revision = publication.revision_number
    if (publication.previous_publication) {
      const previous = (await client.query('SELECT * FROM libro_publications WHERE signal_hash = $1 FOR UPDATE', [publication.previous_publication.signal_hash.toLowerCase()])).rows[0]
      if (!previous) throw new ServiceError('PREDECESSOR_NOT_FOUND', 'Previous version has not finalized yet', 409, true)
      if (previous.signal.author_handle_hash_libro !== publication.author_handle_hash_libro || Boolean(previous.title.trim()) !== Boolean(publication.publication_title.trim()) || Date.parse(publication.initially_published_at) !== new Date(previous.initially_published_at || previous.date).getTime() || publication.revision_number !== previous.revision_number + 1 || publicationRegistration(previous).registry_address !== publication.previous_publication.registry_address.toLowerCase()) throw new ServiceError('REVISION_MISMATCH', 'Frozen update metadata does not match its predecessor', 400)
      previousId = String(previous.id)
      rootId = String(previous.root_publication_id || previous.id)
    }
  }
  await client.query('UPDATE libro_publications SET root_publication_id = $2, previous_publication_id = $3, initially_published_at = $4, revision_number = $5 WHERE id = $1', [publicationId, rootId, previousId, initial, revision])
  return { rootPublicationId: rootId, previousPublicationId: previousId, initiallyPublishedAt: initial, revisionNumber: revision }
}
export async function revisionInfo(row: Record<string, any>, onChain = false): Promise<LibroRevisionInfo> {
  const rootId = String(row.root_publication_id || row.id)
  const head = (await pool.query('SELECT id FROM libro_publications WHERE COALESCE(root_publication_id,id) = $1 ORDER BY revision_number DESC LIMIT 1', [rootId])).rows[0]
  const info: LibroRevisionInfo = { rootPublicationId: rootId, previousPublicationId: row.previous_publication_id == null ? null : String(row.previous_publication_id), latestPublicationId: String(head?.id || row.id), initiallyPublishedAt: new Date(row.initially_published_at || row.date || row.publication_date).toISOString(), revisionNumber: row.revision_number || 1, isLatest: String(head?.id || row.id) === String(row.id) }
  if (!onChain || row.legacy_proof) return info
  try { return await chainRevisionInfo(row, info) }
  catch { return { ...info, isLatest: false, statusAvailable: false } }
}
export async function publicationVersions(publicationId: string) {
  const row = (await pool.query('SELECT * FROM libro_publications WHERE id = $1', [publicationId])).rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Publication not found', 404)
  const rows = (await pool.query('SELECT id, title, date, revision_number, authorship_class FROM libro_publications WHERE COALESCE(root_publication_id,id) = $1 ORDER BY revision_number DESC', [row.root_publication_id || row.id])).rows
  return { versions: rows.map(version => ({ publicationId: String(version.id), revisionNumber: version.revision_number, publicationDate: new Date(version.date).toISOString(), publicationType: version.title.trim() ? 'article' : 'short', authorshipClass: version.authorship_class })) }
}
export async function publicationRevisionStatus(publicationId: string) {
  const row = (await pool.query('SELECT * FROM libro_publications WHERE id = $1', [publicationId])).rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Publication not found', 404)
  const info = await revisionInfo(row)
  return chainRevisionInfo(row, info)
}
async function chainRevisionInfo(row: Record<string, any>, info: LibroRevisionInfo) {
  const status = await readLibroRevisionStatus(publicationRegistration(row), process.env.LIBRO_RPC_URL)
  if (!status.exists) throw new ServiceError('REGISTRATION_MISMATCH', 'Publication is not registered', 422)
  const latestReference: LibroPublicationReference = { chain_id: 480, registry_address: status.latest.registry, signal_hash: normalizeUint256Hex(String(status.latest.signalHash), 'signal_hash') }
  const latest = (await pool.query('SELECT id FROM libro_publications WHERE signal_hash = $1', [latestReference.signal_hash])).rows[0]
  return { ...info, isLatest: status.isLatest, statusAvailable: true, latestReference, latestPublicationId: latest ? String(latest.id) : null, pending: !latest }
}
