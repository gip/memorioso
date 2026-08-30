import { isHex } from 'viem'
import { errorResponse } from '@/lib/errors'
import { finalizeSigning } from '@/lib/human-signing'

export async function PUT(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const { capability } = await context.params
    const body = await request.json() as {
      registrationId?: string
      submissionMethod?: 'world_wallet' | 'libro_relayer'
      transactionHash?: string
      userOpHash?: string
    }
    if (!body.registrationId || !body.submissionMethod || !body.transactionHash || !isHex(body.transactionHash, { strict: true })) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'Registration, submission method, and transaction hash are required', retryable: false } }, { status: 400 })
    }
    return Response.json(await finalizeSigning(capability, {
      registrationId: body.registrationId,
      submissionMethod: body.submissionMethod,
      transactionHash: body.transactionHash,
      userOpHash: body.userOpHash,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
