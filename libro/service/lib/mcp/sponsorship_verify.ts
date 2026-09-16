import { verifySponsorship } from '@/lib/sponsorship'
import { z } from 'zod'

export const schema = z.object({ payload: z.unknown() })

export async function execute(args: z.infer<typeof schema>) {
  const body = args
  await verifySponsorship(body.payload)
  return { verified: true }
}
