import { finalizeAgentSigning } from '@/lib/agent-registrations'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({
  capability: z.string().min(1),
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  userOpHash: z.string().optional(),
})

export async function execute(args: z.infer<typeof schema>) {
  const body = args
  if (!body.transactionHash) throw new ServiceError('INVALID_REQUEST', 'transactionHash is required', 400)
  return await finalizeAgentSigning(args.capability, {
    transactionHash: body.transactionHash,
    userOpHash: body.userOpHash,
  })
}
