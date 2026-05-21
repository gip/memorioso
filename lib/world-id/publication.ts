import { hashSignal } from '@worldcoin/idkit-core/hashing'
import type { Author, ContentOrHtml, LibroAgentPublicationV1, LibroPublicationV1, PublicationV2 } from '@/types'
import { LIBRO_PROTOCOL_VERSION, LIBRO_PUBLICATION_SCHEMA_V1 } from '../libro/contract'
import {
  DEFAULT_WORLD_ID_PUBLISH_ACTION,
  PUBLICATION_SCHEMA_V2,
  WORLD_ID_CREDENTIAL_POLICY,
  WORLD_ID_PROTOCOL_VERSION,
} from './constants'

type JsonPrimitive = string | number | boolean | null
type JsonInput = JsonPrimitive | JsonInput[] | { [key: string]: JsonInput | undefined }

export type PublicationDraftInput = {
  author: Pick<Author, 'id' | 'name' | 'handle' | 'bio'>
  title: string
  subtitle?: string | null
  content: ContentOrHtml
  publicationDate: string
  action?: string
}

export function canonicalizeJson(input: JsonInput): JsonInput {
  if (Array.isArray(input)) {
    return input.map((item) => canonicalizeJson(item))
  }

  if (input !== null && typeof input === 'object') {
    return Object.keys(input)
      .sort()
      .reduce<{ [key: string]: JsonInput }>((acc, key) => {
        const value = input[key]
        if (value !== undefined) {
          acc[key] = canonicalizeJson(value)
        }
        return acc
      }, {})
  }

  return input
}

export function canonicalStringify(input: JsonInput): string {
  return JSON.stringify(canonicalizeJson(input))
}

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
    publication_title: title,
    publication_content: content,
    publication_subtitle: subtitle || '',
  }
}

export function createLibroPublicationV1(input: PublicationDraftInput): LibroPublicationV1 {
  return {
    ...createPublicationV2(input),
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
  }
}

export function isLibroPublicationV1(publication: PublicationV2 | LibroPublicationV1): publication is LibroPublicationV1 {
  return 'libro_protocol_version' in publication && publication.libro_protocol_version === LIBRO_PROTOCOL_VERSION
}

export function canonicalPublicationSignal(publication: PublicationV2 | LibroPublicationV1 | LibroAgentPublicationV1): string {
  return canonicalStringify(publication as unknown as JsonInput)
}

export function hashPublicationSignal(signalText: string): string {
  return hashSignal(signalText).toLowerCase()
}
