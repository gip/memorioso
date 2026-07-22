export const USER_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function normalizeUserHandle(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidUserHandle(value: string): boolean {
  return USER_HANDLE_PATTERN.test(value)
}
