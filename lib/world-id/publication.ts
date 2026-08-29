import {
  canonicalizeJson,
  canonicalStringify,
  canonicalPublicationSignal as canonicalLibroSignal,
  hashPublicationSignal as hashLibroSignal,
  normalizeOptionalPublicationText,
  hashLibroHandle,
} from '@libro/core'
import type {
  Author,
  AuthorReference,
  LibroAgentPublication,
  LibroHumanPublication,
  LibroPublicationV1,
  LibroPublicationV2,
  PublicationContent,
  PublicationV2,
} from '@/types'
import {
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_PUBLICATION_SCHEMA_V2,
} from '../libro/contract'
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

export function createLibroPublicationV2(
  input: PublicationDraftInput & { authorReference?: AuthorReference }
): LibroPublicationV2 {
  return {
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V2,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_protocol_version: WORLD_ID_PROTOCOL_VERSION,
    world_id_proof_type: 'session',
    world_id_credential_policy: WORLD_ID_CREDENTIAL_POLICY,
    ...(input.authorReference ? { author_reference: input.authorReference } : {}),
    publication_date: input.publicationDate,
    author_name_libro: input.author.name,
    author_handle_libro: input.author.handle,
    author_handle_hash_libro: hashLibroHandle(input.author.handle),
    author_bio_libro: input.author.bio || '',
    publication_title: normalizeOptionalPublicationText(input.title),
    publication_content: input.content,
    publication_subtitle: normalizeOptionalPublicationText(input.subtitle),
  }
}

export function isLibroPublicationV1(
  publication: PublicationV2 | LibroHumanPublication
): publication is LibroPublicationV1 {
  return publication.publication_schema === LIBRO_PUBLICATION_SCHEMA_V1
}

export function isLibroHumanPublication(
  publication: PublicationV2 | LibroHumanPublication
): publication is LibroHumanPublication {
  return 'libro_protocol_version' in publication && publication.libro_protocol_version === LIBRO_PROTOCOL_VERSION
}

export function canonicalPublicationSignal(
  publication: PublicationV2 | LibroHumanPublication | LibroAgentPublication
): string {
  return canonicalLibroSignal(publication as unknown as Record<string, unknown>)
}

export function hashPublicationSignal(signalText: string): string {
  return hashLibroSignal(signalText)
}
