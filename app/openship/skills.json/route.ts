import { openshipResponse } from '@/lib/openship/http'
import { getOpenshipSkills } from '@/lib/openship/manifest'

export function GET() {
  return openshipResponse(JSON.stringify(getOpenshipSkills()), 'application/json; charset=utf-8')
}
