import {
  verifyLibroManifestOnChain,
  type LibroEmbedManifestV1,
  type LibroPublicationRecord,
} from '@libro/core'
import { pool } from './db'
import { chainConfig } from './chain'
import { assertWritesEnabled, ServiceError } from './errors'
import { deliverPendingEvents, enqueueServiceEvent } from './events'
import type { OAuthPrincipal } from './oauth'

export async function importPublication(input: {
  principal: OAuthPrincipal
  manifest: unknown
  clientReference?: string
}): Promise<{ publicationId: string; signalHash: string; imported: boolean }> {
  assertWritesEnabled()
  let verified
  try {
    verified = await verifyLibroManifestOnChain(input.manifest, chainConfig().rpcUrls)
  } catch (error) {
    throw new ServiceError(
      'IMPORT_VERIFICATION_FAILED',
      error instanceof Error ? error.message : 'The publication could not be verified on World Chain',
      422,
    )
  }
  const manifest: LibroEmbedManifestV1 = verified.manifest
  if (manifest.publication.author_handle_libro !== input.principal.handle) {
    throw new ServiceError('AUTHOR_MISMATCH', 'Imported publication handle does not match the OAuth identity', 403)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      'SELECT id FROM libro_publications WHERE LOWER(signal_hash) = LOWER($1) FOR UPDATE',
      [manifest.registration.signal_hash],
    )
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return { publicationId: String(existing.rows[0].id), signalHash: manifest.registration.signal_hash, imported: false }
    }
    const proof = {
      proof_type: 'libro_chain_import',
      imported_at: new Date().toISOString(),
      manifest,
      verified_by: verified.verifiedBy,
    }
    const inserted = await client.query(
      `INSERT INTO libro_publications
        (author_id, identity_id, origin_client_id, client_reference, signal_hash,
         authorship_class, signal, proof, version, title, subtitle, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [input.principal.authorId, input.principal.identityId, input.principal.clientId,
        input.clientReference || null, manifest.registration.signal_hash,
        manifest.registration.authorship_class, manifest.publication, proof,
        ('libro_protocol_version' in manifest.publication
          ? manifest.publication.libro_protocol_version
          : manifest.publication.libro_agent_protocol_version),
        manifest.publication.publication_title,
        manifest.publication.publication_subtitle || null, manifest.publication.publication_date],
    )
    const publicationId = String(inserted.rows[0].id)
    await enqueueServiceEvent(client, {
      type: 'publication.finalized',
      originClientId: input.principal.clientId,
      aggregateId: publicationId,
      data: {
        publicationId,
        signalHash: manifest.registration.signal_hash,
        authorId: input.principal.authorId,
        clientReference: input.clientReference || null,
        authorshipClass: manifest.registration.authorship_class,
        imported: true,
      },
    })
    await client.query('COMMIT')
    await deliverPendingEvents(25).catch(() => undefined)
    return { publicationId, signalHash: manifest.registration.signal_hash, imported: true }
  } catch (error) {
    await client.query('ROLLBACK')
    if ((error as { code?: string }).code === '23505') {
      const existing = await pool.query('SELECT id FROM libro_publications WHERE LOWER(signal_hash) = LOWER($1)', [manifest.registration.signal_hash])
      if (existing.rows[0]) return { publicationId: String(existing.rows[0].id), signalHash: manifest.registration.signal_hash, imported: false }
    }
    throw error
  } finally {
    client.release()
  }
}

export function publicationManifest(publication: LibroPublicationRecord): LibroEmbedManifestV1 {
  const imported = publication.proof as { manifest?: unknown }
  if (imported?.manifest) return imported.manifest as LibroEmbedManifestV1
  const proof = publication.proof as Record<string, any>
  const human = proof?.libro_registration
  const agent = proof?.agent_document_signature
  const registration = human ? {
    chain_id: human.chain_id,
    registry_address: human.registry_address,
    signal_hash: human.signal_hash || proof.signal_hash,
    handle_hash: human.handle_hash,
    authorship_class: 'human' as const,
    transaction_hash: human.transaction_hash,
  } : {
    chain_id: agent?.chain_id,
    registry_address: agent?.registry_address,
    signal_hash: agent?.document_signal_hash,
    handle_hash: proof?.agent_registration?.handle_hash,
    authorship_class: 'agent' as const,
    transaction_hash: agent?.transaction_hash,
  }
  return {
    schema: 'libro-embed-v1',
    claim: human ? 'human-signed' : 'human-authorized-agent',
    publication: publication.signal,
    registration,
  } as LibroEmbedManifestV1
}
