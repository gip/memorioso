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
    }
  | {
      success: true
      authenticated: false
      user: null
    }
  | {
      success: false
      message: string
    }
