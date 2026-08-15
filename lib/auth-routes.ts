const AUTH_REQUIRED_PATHS = new Set(['/activity', '/profile'])

export function isAuthRequiredPath(pathname: string): boolean {
  const normalizedPath = pathname.length > 1
    ? pathname.replace(/\/+$/, '')
    : pathname

  if (AUTH_REQUIRED_PATHS.has(normalizedPath)) return true

  const draftMatch = /^\/d\/([^/]+)$/.exec(normalizedPath)
  return Boolean(draftMatch && draftMatch[1] !== 'new')
}
