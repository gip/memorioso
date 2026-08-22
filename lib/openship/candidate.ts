export const candidateSourcesMatch = (payload: unknown, expectedDigest: string): boolean => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const manifest = payload as Record<string, unknown>
  return (
    manifest.openship === '1.0' &&
    manifest.capability === 'sources' &&
    manifest.digest === expectedDigest
  )
}
