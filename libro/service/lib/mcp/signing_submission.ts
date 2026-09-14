import { recordWalletSubmission } from '@/lib/human-signing'
import { z } from 'zod'

export const schema = z.object({
  capability: z.string().min(1),
  registrationId: z.string().min(1),
  userOpHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
})

export async function execute(args: z.infer<typeof schema>) {
  const { capability } = args
  const body = args
  return await recordWalletSubmission(capability, body.registrationId, body.userOpHash)
}
