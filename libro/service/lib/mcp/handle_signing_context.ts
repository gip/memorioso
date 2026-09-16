import { handleClaimContext } from '@/lib/handle-claims'
import { z } from 'zod'

export const schema = z.object({ capability: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  return await handleClaimContext(request, args.capability)
}
