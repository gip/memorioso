import { relaySigning } from '@/lib/human-signing'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ capability: z.string().min(1), registrationId: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>) {
  const { capability } = args
  const body = args
  if (!body.registrationId) throw new ServiceError('INVALID_REQUEST', 'registrationId is required', 400)
  return await relaySigning(capability, body.registrationId)
}
