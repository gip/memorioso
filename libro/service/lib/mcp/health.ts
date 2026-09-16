import { z } from 'zod'

export const schema = z.object({})

export async function execute() {
  return { success: true, service: 'libro', writesEnabled: process.env.LIBRO_SERVICE_WRITES_ENABLED === '1' }
}
