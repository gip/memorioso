export type WorldIdSessionUser = {
  id: number
  subject: string
  handle: string | null
  worldIdSessionId: string
  worldIdCredentialIdentifier: string | null
}

export type WorldIdSessionResponse =
  | {
      success: true
      authenticated: true
      user: WorldIdSessionUser
      libroAuthEnabled?: boolean
    }
  | {
      success: true
      authenticated: false
      user: null
      libroAuthEnabled?: boolean
    }
  | {
      success: false
      message: string
    }
