'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import type { LibroRegistrationTransaction } from './proof'

type WorldAppCommand = {
  name: string
  supported_versions?: number[]
}

type WorldAppWindow = Window & {
  WorldApp?: {
    supported_commands?: WorldAppCommand[]
  }
}

function supportsSendTransaction(): boolean {
  const supportedCommands = (window as WorldAppWindow).WorldApp?.supported_commands

  if (!supportedCommands) {
    return true
  }

  return supportedCommands.some((command) => command.name === 'send-transaction')
}

export function installMiniKitForLibro(): void {
  if (typeof window === 'undefined') {
    throw new Error('MiniKit is only available in the browser')
  }

  const result = MiniKit.install(process.env.NEXT_PUBLIC_WORLD_ID_APP_ID)
  if (!result.success) {
    throw new Error('Open Memorioso in World App for sponsored Libro registration. The Libro contract itself can be called by any wallet or relayer.')
  }

  if (!supportsSendTransaction()) {
    throw new Error('This World App version does not support on-chain registration')
  }
}

export async function sendLibroRegistrationTransaction(
  transaction: LibroRegistrationTransaction
): Promise<{ userOpHash: string }> {
  installMiniKitForLibro()

  const result = await MiniKit.sendTransaction(transaction)
  if (result.executedWith === 'fallback') {
    throw new Error('Memorioso uses MiniKit for sponsored registration. The Libro contract itself is permissionless.')
  }

  return {
    userOpHash: result.data.userOpHash,
  }
}
