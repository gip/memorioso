import { assertInternalDeliveryRequest, deliverPendingEvents } from '@/lib/events'
import { errorResponse } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    assertInternalDeliveryRequest(request)
    return Response.json(await deliverPendingEvents())
  } catch (error) {
    return errorResponse(error)
  }
}
