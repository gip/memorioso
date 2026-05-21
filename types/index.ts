
import type { JsonValue } from '@/lib/json'
import type { WORLD_ID_CREDENTIAL_POLICY, WORLD_ID_PROTOCOL_VERSION, PUBLICATION_SCHEMA_V2 } from '@/lib/world-id/constants'
import type { LIBRO_PROTOCOL_VERSION, LIBRO_PUBLICATION_SCHEMA_V1 } from '@/lib/libro/contract'

export type Author = {
    id: string
    name: string
    handle: string
    bio?: string
  }
  
  export type ContentOrHtml = {
    content: {
      type: string
      content: Array<any>
    }
  } | {
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
    publication_content: ContentOrHtml
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

  export type PublicationRecord = (PublicationV1 | PublicationV2 | LibroPublicationV1) & {
    version: string
  }
  
  export type PublicationInfo = {
    id: string
    author_id_libro: string
    publication_date: string
    author_name_libro: string
    publication_title: string
    publication_subtitle: string
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
      chain_id: number
      registry_address: string
      signal_hash: string
      user_op_hash: string
      transaction_hash: string
      registered_at: string
    }
  }

  export type Proof = LegacyProof | WorldIdProofV4
