import { describe, expect, it } from 'vitest'
import type { IDKitResult } from '@worldcoin/idkit'
import { decodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  canonicalStringify,
  createLibroPublicationV1,
  createPublicationV2,
  canonicalPublicationSignal,
  hashPublicationSignal,
} from '../publication'
import { validateWorldIdV4Result } from '../proof'
import { mapPublicationRow } from '../../db/objects'
import {
  LIBRO_AGENT_AUTHORSHIP_CLAIM,
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_WORLD_CHAIN_ID,
  libroProofRegistryAbi,
} from '../../libro/contract'
import { actionHashToHex, actionHashToUint256, rpIdToUint64 } from '../../libro/encoding'
import { prepareLibroRegistration } from '../../libro/proof'
import {
  createAgentDocumentTypedData,
  createAgentRegistrationPayload,
  createLibroAgentPublicationV1,
  createPrincipalAuthorHash,
  LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
  parseAgentPublicationPayload,
  recoverAgentDocumentSigner,
} from '../../libro/agent'
import {
  getCredentialIdentifierForPublication,
  isLibroAgentProof,
  isLegacyPublication,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '../../publication-status'
import type { JsonValue } from '../../json'
import type { LibroAgentProofV1, PublicationRecord, WorldIdProofV4 } from '../../../types'

const content = { html: '<p>Hello human world.</p>' }
const author = {
  id: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
  name: 'Ada',
  handle: 'ada',
  bio: 'Writes proofs.',
}

function publication(overrides: Partial<Parameters<typeof createPublicationV2>[0]> = {}) {
  return createPublicationV2({
    author,
    title: 'A human note',
    subtitle: 'On signatures',
    content,
    publicationDate: '2026-05-13T12:00:00.000Z',
    action: 'written-by-a-human-v4',
    ...overrides,
  })
}

function result(signalHash: string, overrides: Partial<IDKitResult> = {}): IDKitResult {
  return {
    protocol_version: '4.0',
    action: 'written-by-a-human-v4',
    nonce: 'nonce123',
    environment: 'production',
    responses: [{
      identifier: 'proof_of_human',
      signal_hash: signalHash,
      proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
      nullifier: '0xabc',
      issuer_schema_id: 9303,
      expires_at_min: 1770000000,
    }],
    ...overrides,
  } as IDKitResult
}

describe('World ID publication signals', () => {
  it('canonicalizes object keys deterministically', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalStringify({ a: { c: 3, d: 4 }, b: 2 })
    )
  })

  it('binds signal hash to the exact publication payload', () => {
    const original = canonicalPublicationSignal(publication())
    const changed = canonicalPublicationSignal(publication({ title: 'A changed human note' }))

    expect(hashPublicationSignal(original)).not.toBe(hashPublicationSignal(changed))
  })

  it('does not put the actual credential result into the signed signal', () => {
    const signalText = canonicalPublicationSignal(publication())

    expect(signalText).toContain('"world_id_credential_policy":"orb"')
    expect(signalText).not.toContain('credential_identifier')
    expect(signalText).not.toContain('passport')
  })

  it('creates a Libro v1 publication schema without changing authorship fields', () => {
    const signal = createLibroPublicationV1({
      author,
      title: 'A human note',
      subtitle: 'On signatures',
      content,
      publicationDate: '2026-05-13T12:00:00.000Z',
      action: 'written-by-a-human-v4',
    })

    expect(signal.publication_schema).toBe(LIBRO_PUBLICATION_SCHEMA_V1)
    expect(signal.libro_protocol_version).toBe(LIBRO_PROTOCOL_VERSION)
    expect(signal.author_id_libro).toBe(author.id)
    expect(signal.publication_title).toBe('A human note')
  })

  it('keeps optional title fields present as normalized empty strings', () => {
    const signal = createLibroPublicationV1({
      author,
      title: '   ',
      subtitle: null,
      content,
      publicationDate: '2026-05-13T12:00:00.000Z',
      action: 'written-by-a-human-v4',
    })

    expect(signal.publication_title).toBe('')
    expect(signal.publication_subtitle).toBe('')
    expect(canonicalPublicationSignal(signal)).toContain('"publication_title":""')
    expect(canonicalPublicationSignal(signal)).toContain('"publication_subtitle":""')
  })
})

describe('Libro registration helpers', () => {
  it('maps a World ID v4 response into registry calldata', () => {
    const action = 'written-by-a-human-v4-03b18435-96c5-46e6-91c5-cd4ac1abb197'
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication({ action })))
    const validated = validateWorldIdV4Result(result(signalHash, {
      action,
      nonce: '0x123',
      responses: [{
        identifier: 'proof_of_human',
        signal_hash: signalHash,
        proof: ['1', '2', '3', '4', '5'],
        nullifier: '0xabc',
        issuer_schema_id: 9303,
        expires_at_min: 1770000000,
      }],
    } as Partial<IDKitResult>), {
      action,
      nonce: '0x123',
      environment: 'production',
      signalHash,
    })
    const prepared = prepareLibroRegistration(validated, signalHash, {
      protocolVersion: LIBRO_PROTOCOL_VERSION,
      chainId: LIBRO_WORLD_CHAIN_ID,
      registryAddress: '0x1111111111111111111111111111111111111111',
      rpId: BigInt(1),
      rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'],
    })
    const decoded = decodeFunctionData({
      abi: libroProofRegistryAbi,
      data: prepared.transaction.transactions[0].data,
    })

    expect(prepared.signalHash).toBe(signalHash)
    expect(prepared.signalHashUint256).toBe(BigInt(signalHash).toString())
    expect(prepared.actionHash).toBe(actionHashToUint256(action).toString())
    expect(prepared.proof.nullifier).toBe(BigInt('0xabc').toString())
    expect(prepared.proof.nonce).toBe(BigInt('0x123').toString())
    expect(prepared.proof.zeroKnowledgeProof).toEqual(['1', '2', '3', '4', '5'])
    expect(prepared.transaction.chainId).toBe(480)
    expect(prepared.transaction.transactions[0].to).toBe('0x1111111111111111111111111111111111111111')
    expect(prepared.transaction.transactions[0].data).toMatch(/^0x/)
    expect(decoded.functionName).toBe('register')
    expect(decoded.args[0]).toBe(BigInt(signalHash))
    expect(decoded.args[1]).toBe(actionHashToUint256(action))
  })

  it('validates action hashes and rp ids', () => {
    const fullKeccak = '0x64278be7aebb455c0daa33c32137f5f6f6007a9021f4ab4bb773c82f1ab7c67'

    expect(actionHashToHex('written-by-a-human-v4')).toBe('0x0064278be7aebb455c0daa33c32137f5f6f6007a9021f4ab4bb773c82f1ab7c6')
    expect(actionHashToHex('written-by-a-human-v4')).not.toBe(fullKeccak)
    expect(actionHashToUint256('written-by-a-human-v4')).toBeGreaterThan(BigInt(0))
    expect(rpIdToUint64('rp_81220394c70700e2')).toBe(BigInt('9305003717630034146'))
    expect(() => rpIdToUint64('rp_b8a20e4bc9a21acd00')).toThrow('WORLD_ID_RP_ID must be in')
    expect(() => rpIdToUint64('b8a20e4bc9a21acd')).toThrow('WORLD_ID_RP_ID must be in')
  })
})

describe('Libro agent authorization helpers', () => {
  it('creates a stable agent registration signal hash', () => {
    const principalAuthorHash = createPrincipalAuthorHash(author.id)
    const registration = createAgentRegistrationPayload({
      action: 'register-agent-v1',
      principalAuthorHash,
      controllerAddress: '0x1111111111111111111111111111111111111111',
      agentAddress: '0x2222222222222222222222222222222222222222',
      scope: LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
      validFrom: '2026-05-13T12:00:00.000Z',
      expiresAt: '2026-06-13T12:00:00.000Z',
      salt: '0x3333333333333333333333333333333333333333333333333333333333333333',
      chainId: LIBRO_WORLD_CHAIN_ID,
      registryAddress: '0x4444444444444444444444444444444444444444',
    })

    expect(registration.payload.schema).toBe('libro-agent-registration-v1')
    expect(registration.payload.principal_author_hash).toBe(principalAuthorHash)
    expect(registration.registrationHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(registration.signalHash).toBe(`0x${(BigInt(registration.registrationHash) >> BigInt(8)).toString(16).padStart(64, '0')}`)
  })

  it('creates an agent publication schema distinct from direct human authorship', () => {
    const agentPublication = createLibroAgentPublicationV1({
      author,
      title: 'A delegated note',
      subtitle: 'On agents',
      content,
      publicationDate: '2026-05-13T12:00:00.000Z',
      principalAuthorHash: createPrincipalAuthorHash(author.id),
      agentAddress: '0x2222222222222222222222222222222222222222',
      agentRegistrationHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
    })
    const humanPublication = createLibroPublicationV1({
      author,
      title: 'A delegated note',
      subtitle: 'On agents',
      content,
      publicationDate: '2026-05-13T12:00:00.000Z',
      action: 'written-by-a-human-v4',
    })

    expect(agentPublication.publication_schema).toBe(LIBRO_AGENT_PUBLICATION_SCHEMA_V1)
    expect(agentPublication.libro_agent_protocol_version).toBe(LIBRO_AGENT_PROTOCOL_VERSION)
    expect(agentPublication.authorship_claim).toBe(LIBRO_AGENT_AUTHORSHIP_CLAIM)
    expect(canonicalPublicationSignal(agentPublication)).not.toBe(canonicalPublicationSignal(humanPublication))
  })

  it('recovers the EIP-712 document signer', async () => {
    const account = privateKeyToAccount('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const typedData = createAgentDocumentTypedData({
      chainId: LIBRO_WORLD_CHAIN_ID,
      registryAddress: '0x4444444444444444444444444444444444444444',
      registrationHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      documentSignalHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
      documentNonce: '0x6666666666666666666666666666666666666666666666666666666666666666',
      signedAt: 1770000000,
    })
    const signature = await account.signTypedData(typedData)

    await expect(recoverAgentDocumentSigner({ typedData, signature })).resolves.toBe(account.address)
  })

  it('only accepts HTML publication content for agent documents', () => {
    expect(parseAgentPublicationPayload({
      title: 'A delegated note',
      subtitle: 'On agents',
      content,
    }).content).toEqual(content)

    expect(() => parseAgentPublicationPayload({
      title: 'A delegated note',
      content: {
        type: 'doc',
        content: [],
      },
    })).toThrow('Publication content HTML is required')
  })

  it('accepts agent documents with either a title or readable content', () => {
    expect(parseAgentPublicationPayload({ title: '', subtitle: '', content })).toMatchObject({
      title: '',
      subtitle: '',
    })
    expect(parseAgentPublicationPayload({
      title: 'Title only',
      content: { html: '<p><br></p>' },
    })).toMatchObject({
      title: 'Title only',
      content: { html: '<p><br></p>' },
    })
    expect(() => parseAgentPublicationPayload({
      title: '   ',
      content: { html: '<p><br></p>' },
    })).toThrow('Publication must include a title or readable content')
  })
})

describe('publication version compatibility', () => {
  it('maps table version onto the publication record', () => {
    const mapped = mapPublicationRow({
      signal: publication(),
      version: '1',
    })

    expect(mapped.version).toBe('1')
    expect(mapped.publication_title).toBe('A human note')
  })

  it('marks version 1 publications as visible but not verifiable', () => {
    const legacyPublication: PublicationRecord = {
      ...publication(),
      version: '1',
    }
    const v4Proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      signal_text: canonicalPublicationSignal(publication()),
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication())),
      credential_identifier: 'passport',
      credential_identifiers: ['passport'],
      idkit_result: result('0x123') as unknown as JsonValue,
      verify_response: { success: true },
    }

    expect(isLegacyPublication(legacyPublication)).toBe(true)
    expect(LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE).toContain('independent verification is no longer available')
    expect(getCredentialIdentifierForPublication(legacyPublication, v4Proof)).toBeNull()
  })

  it('keeps version 2 credential display derived from proof JSON', () => {
    const v2Publication: PublicationRecord = {
      ...publication(),
      version: '2',
    }
    const v4Proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      signal_text: canonicalPublicationSignal(publication()),
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication())),
      credential_identifier: 'passport',
      credential_identifiers: ['passport'],
      idkit_result: result('0x123') as unknown as JsonValue,
      verify_response: { success: true },
    }

    expect(isLegacyPublication(v2Publication)).toBe(false)
    expect(getCredentialIdentifierForPublication(v2Publication, v4Proof)).toBe('passport')
  })

  it('distinguishes human-authorized agent proofs from direct World ID proofs', () => {
    const proof: LibroAgentProofV1 = {
      proof_type: 'human_authorized_agent_signature',
      protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      agent_registration: {
        action: 'register-agent-v1',
        signal: '0x1234',
        signal_hash: '0x1234',
        registration_hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        payload: {},
        credential_identifier: 'passport',
        credential_identifiers: ['passport'],
        idkit_result: {},
        chain_id: LIBRO_WORLD_CHAIN_ID,
        registry_address: '0x4444444444444444444444444444444444444444',
        user_op_hash: '0x1',
        transaction_hash: '0x2',
        registered_at: '2026-05-13T12:00:00.000Z',
      },
      agent_document_signature: {
        document_signal_text: '{}',
        document_signal_hash: '0x5555555555555555555555555555555555555555555555555555555555555555',
        document_nonce: '0x6666666666666666666666666666666666666666666666666666666666666666',
        signed_at: '2026-05-13T12:00:00.000Z',
        agent_address: '0x2222222222222222222222222222222222222222',
        signature_type: 'eip712',
        signature: '0x1234',
        chain_id: LIBRO_WORLD_CHAIN_ID,
        registry_address: '0x4444444444444444444444444444444444444444',
        user_op_hash: '0x3',
        transaction_hash: '0x4',
        registered_at: '2026-05-13T12:00:00.000Z',
      },
    }

    expect(isLibroAgentProof(proof)).toBe(true)
    expect(getCredentialIdentifierForPublication({ ...publication(), version: '4' }, proof)).toBeNull()
  })
})

describe('World ID v4 result validation', () => {
  it('accepts v4 proof-of-human results bound to the signal hash', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication()))

    expect(() => validateWorldIdV4Result(result(signalHash), {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash,
    })).not.toThrow()
  })

  it('rejects document credentials', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication()))

    for (const identifier of ['selfie', 'passport', 'mnc']) {
      expect(() => validateWorldIdV4Result(result(signalHash, {
        responses: [{
          identifier,
          signal_hash: signalHash,
          proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
          nullifier: '0xabc',
          issuer_schema_id: 9303,
          expires_at_min: 1770000000,
        }],
      } as Partial<IDKitResult>), {
        action: 'written-by-a-human-v4',
        nonce: 'nonce123',
        environment: 'production',
        signalHash,
      })).toThrow(`Unsupported World ID credential: ${identifier}`)
    }
  })

  it('rejects legacy v3 results', () => {
    expect(() => validateWorldIdV4Result({
      protocol_version: '3.0',
      nonce: 'nonce123',
      action: 'written-by-a-human-v4',
      environment: 'production',
      responses: [],
    } as unknown as IDKitResult, {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash: '0x123',
    })).toThrow('World ID 4.0 proof is required')
  })

  it('rejects results whose response hash is not the publication signal hash', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication()))

    expect(() => validateWorldIdV4Result(result('0xdeadbeef'), {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash,
    })).toThrow('World ID signal hash does not match the publication payload')
  })
})
