// The canonical exact and `/**` grammar comes from OpenShip. Memorioso additionally retains the
// suffix-only `**` form for private source-ignore rules; it is never advertised as protocol policy.

import { matchOpenShipPattern } from '@openship/protocol'

/**
 * `a/b/**` is the OpenShip v1 selector. The suffix-only `a/b**` form remains for Memorioso's
 * internal source-ignore patterns and is never published as Changes policy.
 */
export const matchesPattern = (filePath: string, pattern: string): boolean => {
  if (pattern.endsWith('/**') || !pattern.endsWith('**')) {
    try {
      return matchOpenShipPattern(pattern, filePath)
    } catch {
      return false
    }
  }
  if (pattern.endsWith('**')) return filePath.startsWith(pattern.slice(0, -2))
  return false
}

export const matchesAny = (filePath: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => matchesPattern(filePath, pattern))
