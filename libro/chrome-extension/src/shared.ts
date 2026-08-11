export type LibroCandidate = {
  blockId: string
  kind: 'embed' | 'text'
  innerHtml: string
  readableText?: string
  snapshotHtml: string
  declaredHash: string | null
  manifestId: string | null
  manifestText: string | null
  manifestUrl?: string | null
  declaredAuthorHandle?: string
  declaredPublicationDate?: string
  error?: string
}

export type LibroVerificationStatus =
  | 'verified'
  | 'text_mismatch'
  | 'invalid_manifest'
  | 'manifest_missing'
  | 'unsupported_registry'
  | 'not_registered'
  | 'registration_unconfirmed'
  | 'network_unavailable'
  | 'stale'

/**
 * Statuses that mean "we could not decide", as opposed to "this block is wrong".
 * These render amber rather than red.
 */
const INDETERMINATE_STATUSES: ReadonlySet<LibroVerificationStatus> = new Set([
  'manifest_missing',
  'registration_unconfirmed',
  'network_unavailable',
  'stale',
])

export function isIndeterminateStatus(status: LibroVerificationStatus): boolean {
  return INDETERMINATE_STATUSES.has(status)
}

/** What one World Chain endpoint reported, so the panel can show the whole quorum. */
export type LibroVerificationSource = {
  label: string
  status: 'verified' | 'not_registered' | 'mismatch' | 'unconfirmed' | 'unavailable'
  detail: string
}

export type LibroVerificationResult = {
  blockId: string
  status: LibroVerificationStatus
  label: string
  detail: string
  authorHandle?: string
  publicationDate?: string
  signalHash?: string
  sources?: LibroVerificationSource[]
  verifiedBy?: string[]
}

export type ScanResponse = {
  success: boolean
  results: LibroVerificationResult[]
  message?: string
}
