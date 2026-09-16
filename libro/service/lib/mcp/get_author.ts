import { getAuthor } from '@/lib/publications'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ idOrHandle: z.string().min(1) })

export async function execute(args: z.infer<typeof schema>) {
  const { idOrHandle } = args
  const author = await getAuthor(idOrHandle)
  if (!author) throw new ServiceError('NOT_FOUND', 'Author not found', 404)
  return author
}
