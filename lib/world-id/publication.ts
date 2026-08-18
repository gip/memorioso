import {
  canonicalizeJson,
  canonicalStringify,
  canonicalPublicationSignal as canonicalLibroSignal,
  hashPublicationSignal as hashLibroSignal,
  normalizeOptionalPublicationText,
  hashLibroHandle,
} from '@libro/core'
import type { Author, LibroAgentPublicationV1, LibroPublicationV1, PublicationContent, PublicationV2 } from '@/types'
import { LIBRO_PROTOCOL_VERSION, LIBRO_PUBLICATION_SCHEMA_V1 } from '../libro/contract'
import {
  DEFAULT_WORLD_ID_PUBLISH_ACTION,
  PUBLICATION_SCHEMA_V2,
  WORLD_ID_CREDENTIAL_POLICY,
  WORLD_ID_PROTOCOL_VERSION,
} from './constants'

export type PublicationDraftInput = {
  author: Pick<Author, 'id' | 'name' | 'handle' | 'bio'>
  title: string
  subtitle?: string | null
  content: PublicationContent
  publicationDate: string
  action?: string
}

export { canonicalizeJson, canonicalStringify }

export function createPublicationV2({
  author,
  title,
  subtitle,
  content,
  publicationDate,
  action = DEFAULT_WORLD_ID_PUBLISH_ACTION,
}: PublicationDraftInput): PublicationV2 {
  return {
    publication_schema: PUBLICATION_SCHEMA_V2,
    world_id_protocol_version: WORLD_ID_PROTOCOL_VERSION,
    world_id_action: action,
    world_id_credential_policy: WORLD_ID_CREDENTIAL_POLICY,
    author_id_libro: author.id,
    publication_date: publicationDate,
    author_name_libro: author.name,
    author_handle_libro: author.handle,
    author_bio_libro: author.bio || '',
    publication_title: normalizeOptionalPublicationText(title),
    publication_content: content,
    publication_subtitle: normalizeOptionalPublicationText(subtitle),
  }
}

export function createLibroPublicationV1(input: PublicationDraftInput): LibroPublicationV1 {
  const publication = createPublicationV2(input)
  const { world_id_action: _legacyAction, ...sessionPublication } = publication
  return {
    ...sessionPublication,
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_proof_type: 'session',
    author_handle_hash_libro: hashLibroHandle(input.author.handle),
  }
}

export function isLibroPublicationV1(publication: PublicationV2 | LibroPublicationV1): publication is LibroPublicationV1 {
  return 'libro_protocol_version' in publication && publication.libro_protocol_version === LIBRO_PROTOCOL_VERSION
}

export function canonicalPublicationSignal(publication: PublicationV2 | LibroPublicationV1 | LibroAgentPublicationV1): string {
  return canonicalLibroSignal(publication as unknown as Record<string, unknown>)
}

export function hashPublicationSignal(signalText: string): string {
  return hashLibroSignal(signalText)
}
