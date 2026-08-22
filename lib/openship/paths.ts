// The one path-pattern matcher in the repository. Shared because the change policy, the manifest
// checker, and the build script all decide membership the same way, and three implementations of
// "does this path match" would be three chances to disagree about what is protected.

/**
 * `a/b/**` is the OpenShip v1 selector. The suffix-only `a/b**` form remains for Memorioso's
 * internal source-ignore patterns and is never published as Changes policy.
 */
export const matchesPattern = (filePath: string, pattern: string): boolean => {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3)
    return filePath === prefix || filePath.startsWith(`${prefix}/`)
  }
  if (pattern.endsWith('**')) return filePath.startsWith(pattern.slice(0, -2))
  return filePath === pattern
}

export const matchesAny = (filePath: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => matchesPattern(filePath, pattern))
