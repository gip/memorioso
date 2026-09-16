import { prepareSigning } from '@/lib/human-signing'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ capability: z.string().min(1), idkitResult: z.unknown() })

export async function execute(args: z.infer<typeof schema>) {
  const { capability } = args
  const body = args
  if (!body.idkitResult) throw new ServiceError('INVALID_REQUEST', 'idkitResult is required', 400)
  return await prepareSigning(capability, body.idkitResult)
}
