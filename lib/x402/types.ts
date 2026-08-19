export type PaymentRequirements = {
  scheme: 'exact'
  network: string
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra: { name: string; version: string }
}

export type ExactEvmAuthorization = {
  from: `0x${string}`
  to: `0x${string}`
  value: string
  validAfter: string
  validBefore: string
  nonce: `0x${string}`
}

export type ExactEvmPayload = {
  signature: `0x${string}`
  authorization: ExactEvmAuthorization
}

export type PaymentPayload = {
  x402Version: number
  scheme: string
  network: string
  payload: ExactEvmPayload
}

export type SettlementResponse = {
  success: boolean
  transaction: string
  network: string
  payer: string
}

export type PaymentRequiredBody = {
  x402Version: number
  error: string
  accepts: PaymentRequirements[]
}
