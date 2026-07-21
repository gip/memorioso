import { NextResponse } from 'next/server'
import { WORLD_ID_PROOF_TEST_ACTION } from '@/lib/world-id/constants'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'

export async function GET() {
  let config
  let rpContext
  try {
    config = getWorldIdServerConfig()
    rpContext = createRpContext(config, WORLD_ID_PROOF_TEST_ACTION)
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'World ID configuration is invalid',
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    appId: config.appId,
    environment: config.environment,
    action: WORLD_ID_PROOF_TEST_ACTION,
    rpContext,
  })
}
