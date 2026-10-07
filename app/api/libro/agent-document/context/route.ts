import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'
import { getPublicationVersionStatus } from '@/lib/publication-revisions'
import { buildLibroEmbedManifest } from '@/lib/libro/embed'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import {
  buildAgentPublicationSignal,
  createAgentDocumentTypedData,
  createLibroAgentPublicationV3,
  parseAgentPublicationPayload,
} from '@/lib/libro/agent'
import { getMemoriosoAuthorNamespace, getMemoriosoAuthorReference } from '@/lib/libro/author-reference'

type AgentDocumentContextRequest = {
  registrationHash?: unknown
  publication?: unknown
  previousPublicationId?: string
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse(); if (retired) return retired
  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
    getMemoriosoAuthorNamespace()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as AgentDocumentContextRequest | null
  const registrationHash = typeof body?.registrationHash === 'string' ? body.registrationHash : null

  if (!registrationHash) {
    return NextResponse.json({ success: false, message: 'Agent registration hash is required' }, { status: 400 })
  }

  let publicationInput
  try {
    publicationInput = parseAgentPublicationPayload(body?.publication)
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Publication payload is invalid',
    }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT r.*, a.name AS author_name, a.handle AS author_handle, a.bio AS author_bio
       FROM libro_agent_registrations r
       INNER JOIN authors a ON a.id = r."authorId"
       WHERE r.registration_hash = $1
         AND r.finalized_at IS NOT NULL
         AND r.revoked_at IS NULL`,
      [registrationHash.toLowerCase()]
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Active agent registration not found' }, { status: 404 })
    }

    const registration = rows[0]
    if (new Date(registration.expires_at) < new Date()) {
      return NextResponse.json({ success: false, message: 'Agent registration has expired' }, { status: 400 })
    }

    if (registration.registry_address.toLowerCase() !== agentConfig.registryAddress) return NextResponse.json({ success: false, message: 'This v1 agent needs fresh authorization in Libro v2' }, { status: 409 })
    let revision = {}
    if (body?.previousPublicationId) {
      const previous = (await client.query('SELECT * FROM publications WHERE id = $1 AND "authorId" = $2', [body.previousPublicationId, registration.authorId])).rows[0]
      if (!previous) return NextResponse.json({ message: 'Previous publication not found' }, { status: 404 })
      const status = await getPublicationVersionStatus(String(previous.id), client)
      const manifest = buildLibroEmbedManifest(previous.signal, previous.proof, String(previous.id))
      if (!status.isLatest || manifest.registration.authorship_class !== 'agent') return NextResponse.json({ message: 'Start from the latest agent version' }, { status: 409 })
      revision = { previous_publication: { chain_id: 480, registry_address: manifest.registration.registry_address, signal_hash: manifest.registration.signal_hash }, initially_published_at: status.initiallyPublishedAt, revision_number: status.revisionNumber + 1 }
    }
    const publicationDate = new Date().toISOString()
    const publication = createLibroAgentPublicationV3({
      ...revision, publication_registry: agentConfig.registryAddress,
      author: {
        id: registration.authorId,
        name: registration.author_name,
        handle: registration.author_handle,
        bio: registration.author_bio || '',
      },
      title: publicationInput.title,
      subtitle: publicationInput.subtitle,
      content: publicationInput.content,
      publicationDate,
      authorReference: getMemoriosoAuthorReference(registration.authorId),
      agentAddress: registration.agent_address,
      agentRegistrationHash: registration.registration_hash,
    })
    const { signalText, signalHash } = buildAgentPublicationSignal(publication)
    const documentNonce = randomBytes32()
    const signedAt = Math.floor(Date.now() / 1000)
    const typedData = createAgentDocumentTypedData({
      chainId: agentConfig.chainId,
      registryAddress: agentConfig.registryAddress,
      registrationHash,
      documentSignalHash: signalHash,
      documentNonce,
      signedAt,
    })

    return NextResponse.json({
      success: true,
      publication,
      signalText,
      signalHash,
      documentNonce,
      signedAt,
      typedData,
    })
  } finally {
    client.release()
  }
}
