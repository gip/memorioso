import { z } from 'zod'
import { createDynamicClientId, exchangeAuthorizationCode, exchangeRefreshToken, revokeOAuthToken } from '@/lib/oauth'
import { pool } from '@/lib/db'
import { ServiceError } from '@/lib/errors'
import { mcpResource } from '@/lib/config'

export const formSchema = z.object({ form: z.record(z.string(), z.string()) })
export const registerSchema = z.object({ redirect_uris: z.array(z.string()).min(1), client_name: z.string().optional() })

function validRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  } catch { return false }
}

export async function registerClient(args: z.infer<typeof registerSchema>) {
  if (!args.redirect_uris.every(validRedirect)) throw new ServiceError('invalid_redirect_uri', 'Invalid client redirect URI', 400)
  const clientId = createDynamicClientId()
  await pool.query(
    `INSERT INTO libro_oauth_clients
      (id, client_type, redirect_uris, resource, display_name, dynamically_registered)
     VALUES ($1, 'public', $2, $3, $4, TRUE)`,
    [clientId, args.redirect_uris, mcpResource(), args.client_name?.slice(0, 120) || null],
  )
  return { client_id: clientId, redirect_uris: args.redirect_uris, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }
}

export async function token(request: Request, args: z.infer<typeof formSchema>) {
  const form = new URLSearchParams(args.form)
  const grantType = form.get('grant_type')
  const issued = grantType === 'authorization_code' ? await exchangeAuthorizationCode(request, form)
    : grantType === 'refresh_token' ? await exchangeRefreshToken(request, form) : null
  if (!issued) throw new ServiceError('unsupported_grant_type', 'Unsupported OAuth grant type', 400)
  return { access_token: issued.accessToken, token_type: 'Bearer', expires_in: 900,
    refresh_token: issued.refreshToken, scope: issued.scope }
}

export async function revoke(request: Request, args: z.infer<typeof formSchema>) {
  await revokeOAuthToken(request, new URLSearchParams(args.form))
  return { revoked: true }
}
