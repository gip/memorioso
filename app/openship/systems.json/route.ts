import { openshipResponse } from '@/lib/openship/http'
import { getOpenshipSystemsJson } from '@/lib/openship/manifest'

export function GET() {
  return openshipResponse(getOpenshipSystemsJson(), 'application/json; charset=utf-8')
}
