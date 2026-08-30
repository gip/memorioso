export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidHandle(value: string): boolean {
  return /^[a-z0-9_-]{3,32}$/.test(value)
}
