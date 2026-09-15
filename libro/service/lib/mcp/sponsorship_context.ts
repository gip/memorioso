import { sponsorshipContext } from '@/lib/sponsorship'
import { z } from 'zod'

export const schema = z.object({})

export async function execute(args: z.infer<typeof schema>, request: Request) {
  return await sponsorshipContext(request)
}
