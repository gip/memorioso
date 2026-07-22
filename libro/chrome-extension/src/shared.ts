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
  | 'network_unavailable'
  | 'stale'

export type LibroVerificationResult = {
  blockId: string
  status: LibroVerificationStatus
  label: string
  detail: string
  authorHandle?: string
  publicationDate?: string
  signalHash?: string
}

export type ScanResponse = {
  success: boolean
  results: LibroVerificationResult[]
  message?: string
}
