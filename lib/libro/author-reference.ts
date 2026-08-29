import { parseLibroAuthorReference, type LibroAuthorReference } from '@libro/core'

export function getMemoriosoAuthorNamespace(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is required')

  let namespace: string
  try {
    namespace = new URL(appUrl).origin
  } catch {
    throw new Error('NEXT_PUBLIC_APP_URL must be a valid absolute URL')
  }

  return parseLibroAuthorReference({ namespace, id: 'configuration-check' }).namespace
}

export function getMemoriosoAuthorReference(authorId: string): LibroAuthorReference {
  return parseLibroAuthorReference({ namespace: getMemoriosoAuthorNamespace(), id: authorId })
}
