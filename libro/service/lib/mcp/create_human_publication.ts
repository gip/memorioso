import { createHumanChallenge } from '@/lib/human-publications'
import { authenticateBearer } from '@/lib/oauth'
import { ServiceError } from '@/lib/errors'
import { mcpResource } from '@/lib/config'
import { z } from 'zod'

export const schema = z.object({
  publication: z.record(z.string(), z.unknown()),
  clientReference: z.string().min(1).max(256).optional(),
})

export async function execute(args: z.infer<typeof schema>, request: Request) {
  const resource = mcpResource()
  const principal = await authenticateBearer(request, 'publish', resource)
  const body = args
  if (!body.publication) throw new ServiceError('INVALID_REQUEST', 'publication is required', 400)
  return await createHumanChallenge({
    principal,
    publication: body.publication,
    clientReference: body.clientReference,
  })
}
