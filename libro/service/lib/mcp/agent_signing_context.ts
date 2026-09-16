import { agentSigningContext } from '@/lib/agent-registrations'
import { z } from 'zod'

export const schema = z.object({ capability: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  return await agentSigningContext(request, args.capability)
}
