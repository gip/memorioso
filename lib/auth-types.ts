export type WalletSessionUser = {
  id: number
  subject: string
  walletAddress: string
}

export type WalletSessionResponse =
  | {
      success: true
      authenticated: true
      user: WalletSessionUser
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
