
import type { JsonValue } from '@/lib/json'
import type { WORLD_ID_CREDENTIAL_POLICY, WORLD_ID_PROTOCOL_VERSION, PUBLICATION_SCHEMA_V2 } from '@/lib/world-id/constants'
import type {
    LIBRO_AGENT_AUTHORSHIP_CLAIM,
    LIBRO_AGENT_PROTOCOL_VERSION,
    LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
    LIBRO_PROTOCOL_VERSION,
    LIBRO_PUBLICATION_SCHEMA_V1,
} from '@/lib/libro/contract'

export type Author = {
    id: string
    name: string
    handle: string
    bio?: string
    userId?: number
  }
  
  export type PublicationContent = {
    html: string
  }
  
  // Publication payload V1 that is signed
  export type PublicationV1 = {
    author_id_libro: string
    publication_date: string
    author_name_libro: string
    author_handle_libro: string
    author_bio_libro: string
    publication_title: string
    publication_content: PublicationContent
    publication_subtitle: string
  }

  export type PublicationV2 = PublicationV1 & {
    publication_schema: typeof PUBLICATION_SCHEMA_V2
    world_id_protocol_version: typeof WORLD_ID_PROTOCOL_VERSION
    world_id_action: string
    world_id_credential_policy: typeof WORLD_ID_CREDENTIAL_POLICY
  }

  export type LibroPublicationV1 = Omit<PublicationV2, 'publication_schema'> & {
    publication_schema: typeof LIBRO_PUBLICATION_SCHEMA_V1
    libro_protocol_version: typeof LIBRO_PROTOCOL_VERSION
  }

  export type LibroAgentPublicationV1 = PublicationV1 & {
    publication_schema: typeof LIBRO_AGENT_PUBLICATION_SCHEMA_V1
    libro_agent_protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
    authorship_claim: typeof LIBRO_AGENT_AUTHORSHIP_CLAIM
    principal_author_hash: string
    agent_address: string
    agent_registration_hash: string
  }

  export type PublicationRecord = (PublicationV1 | PublicationV2 | LibroPublicationV1 | LibroAgentPublicationV1) & {
    version: string
  }
  
  export type PublicationInfo = {
    id: string
    author_id_libro: string
    publication_date: string
    author_name_libro: string
    publication_title: string
    publication_subtitle: string
    publication_excerpt: string
    authorship_label: 'Signed by a human' | 'Human-authorized agent'
  }
  
  export type LegacyProof = {
    proof: string
    merkle_root: string
    nullifier_hash: string
    verification_level: 'orb'
  }

  export type WorldIdProofV4 = {
    protocol_version: '4.0'
    action: string
    nonce: string
    signal_text: string
    signal_hash: string
    credential_identifier: string
    credential_identifiers: string[]
    idkit_result: JsonValue
    verify_response: JsonValue
    libro_registration?: {
      protocol_version: typeof LIBRO_PROTOCOL_VERSION
      submission_method?: 'world_wallet' | 'memorioso_relayer'
      chain_id: number
      registry_address: string
      signal_hash: string
      action_hash: string
      user_op_hash?: string
      transaction_hash: string
      registered_at: string
    }
  }

  export type LibroAgentProofV1 = {
    proof_type: 'human_authorized_agent_signature'
    protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
    agent_registration: {
      action: string
      signal: string
      signal_hash: string
      registration_hash: string
      payload: JsonValue
      credential_identifier: string
      credential_identifiers: string[]
      idkit_result: JsonValue
      chain_id: number
      registry_address: string
      user_op_hash: string
      transaction_hash: string
      registered_at: string
    }
    agent_document_signature: {
      document_signal_text: string
      document_signal_hash: string
      document_nonce: string
      signed_at: string
      agent_address: string
      signature_type: 'eip712'
      signature: string
      chain_id: number
      registry_address: string
      user_op_hash: string
      transaction_hash: string
      registered_at: string
    }
  }

  export type Proof = LegacyProof | WorldIdProofV4 | LibroAgentProofV1
