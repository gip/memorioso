import { getPublicationBySignal } from '@/lib/publications'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ signalHash: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>) {
  const { signalHash } = args
  const publication = await getPublicationBySignal(signalHash)
  if (!publication) throw new ServiceError('NOT_FOUND', 'Publication not found', 404)
  return publication
}
