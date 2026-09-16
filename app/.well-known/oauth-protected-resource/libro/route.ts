import { connection } from 'next/server'
import { libroOAuthMetadata } from '@/lib/libro-service/oauth-metadata'

export async function GET(): Promise<Response> {
  await connection()
  return Response.json(libroOAuthMetadata().protectedResource, {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  })
}
