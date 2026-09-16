import { isHex } from 'viem'
import { finalizeSigning } from '@/lib/human-signing'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({
  capability: z.string().min(1),
  registrationId: z.string().min(1),
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  userOpHash: z.string().optional(),
  submissionMethod: z.enum(['world_wallet', 'libro_relayer']),
})

export async function execute(args: z.infer<typeof schema>) {
  const { capability } = args
  const body = args
  if (!body.registrationId || !body.submissionMethod || !body.transactionHash || !isHex(body.transactionHash, { strict: true })) {
    throw new ServiceError('INVALID_REQUEST', 'Registration, submission method, and transaction hash are required', 400)
  }
  return await finalizeSigning(capability, {
    registrationId: body.registrationId,
    submissionMethod: body.submissionMethod,
    transactionHash: body.transactionHash,
    userOpHash: body.userOpHash,
  })
}
