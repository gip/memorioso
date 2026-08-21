// The one path-pattern matcher in the repository. Shared because the change policy, the manifest
// checker, and the build script all decide membership the same way, and three implementations of
// "does this path match" would be three chances to disagree about what is protected.

/** `a/b/**` matches `a/b` and anything under it; `a/b**` matches any path starting `a/b`. */
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
