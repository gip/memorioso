import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import {
  buildAgentPublicationSignal,
  createAgentDocumentTypedData,
  createLibroAgentPublicationV1,
  parseAgentPublicationPayload,
} from '@/lib/libro/agent'

type AgentDocumentContextRequest = {
  registrationHash?: unknown
  publication?: unknown
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
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

    const publicationDate = new Date().toISOString()
    const publication = createLibroAgentPublicationV1({
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
