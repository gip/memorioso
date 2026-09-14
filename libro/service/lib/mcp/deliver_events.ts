import { z } from 'zod'
import { assertInternalDeliveryRequest, deliverPendingEvents } from '@/lib/events'

export const schema = z.object({})

export async function execute(request: Request) {
  assertInternalDeliveryRequest(request)
  return deliverPendingEvents()
}
