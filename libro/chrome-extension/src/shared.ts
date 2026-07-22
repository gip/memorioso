export type LibroCandidate = {
  blockId: string
  innerHtml: string
  declaredHash: string | null
  manifestId: string | null
  manifestText: string | null
  error?: string
}

export type LibroVerificationStatus =
  | 'verified'
  | 'text_mismatch'
  | 'invalid_manifest'
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
