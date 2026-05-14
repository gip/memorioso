import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user?: {
      id?: string
      name?: string | null
      email?: string | null
      image?: string | null
      worldIdSessionId?: string | null
      worldIdCredentialIdentifier?: string | null
    }
  }

  interface User {
    worldIdSessionId?: string | null
    worldIdCredentialIdentifier?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string
    worldIdSessionId?: string | null
    worldIdCredentialIdentifier?: string | null
  }
}
