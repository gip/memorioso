import { signingContext } from '@/lib/human-signing'
import { z } from 'zod'

export const schema = z.object({ capability: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  const { capability } = args
  return await signingContext(request, capability)
}
