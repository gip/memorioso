import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ cookie: new Map<string,string>(), issue: vi.fn(), identity: 'identity-1', verifiedAt: new Date() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (key: string) => ({ value: state.cookie.get(key) }), set: (key: string, value: string) => state.cookie.set(key,value) }) }))
vi.mock('@/lib/session', () => ({ browserIdentityId: async () => state.identity, identitySessionCookieOptions: {} }))
vi.mock('@/lib/db', () => ({ pool: { query: async () => ({ rows: [{ verified_at: state.verifiedAt }] }) } }))
vi.mock('@/lib/oauth', async (original) => ({ ...await original<object>(),
  getClient: async () => ({ id: 'client', redirect_uris: ['https://client.test/callback'], resource: 'https://libro.test/mcp', display_name: '<script>bad</script>' }),
  issueAuthorizationCode: state.issue,
}))
import { GET, POST } from './route'
const url = () => 'https://libro.test/oauth/authorize?'+new URLSearchParams({ client_id:'client', response_type:'code', redirect_uri:'https://client.test/callback',
  resource:'https://libro.test/mcp', code_challenge:'a'.repeat(43), code_challenge_method:'S256', scope:'profile publish', state:'client-state' })
async function consentToken() {
  const response = await GET(new Request(url()))
  return { response, html: await response.text() }
}
function post(token: string, decision = 'approve', origin = 'https://libro.test') {
  return POST(new Request('https://libro.test/oauth/authorize', { method:'POST', headers:{ Origin:origin }, body:new URLSearchParams({ consent:token, decision }) }))
}
describe('OAuth consent', () => {
  beforeEach(() => {
    process.env.LIBRO_SERVICE_URL='https://libro.test'
    process.env.LIBRO_MCP_STATE_SECRET='consent-test-secret-at-least-thirty-two-bytes'
    state.identity='identity-1'; state.verifiedAt=new Date(); state.cookie.clear(); state.issue.mockReset().mockResolvedValue('approved-code')
  })
  it('GET displays escaped client details without issuing a grant; explicit approval issues the code', async () => {
    const { response,html }=await consentToken()
    expect(response.status).toBe(200)
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(state.issue).not.toHaveBeenCalled()
    const token=html.match(/name="consent" value="([^"]+)"/)![1]
    const approved=await post(token)
    expect(approved.status).toBe(303)
    expect(approved.headers.get('location')).toContain('code=approved-code')
    expect(approved.headers.get('location')).toContain('state=client-state')
    expect(state.issue).toHaveBeenCalledWith(expect.objectContaining({ identityId:'identity-1', scope:['profile','publish'] }))
    expect((await post(token)).status).toBe(400)
  })
  it('rejects cross-origin, tampered, wrong-cookie, and wrong-identity approvals', async () => {
    const {html}=await consentToken();const token=html.match(/name="consent" value="([^"]+)"/)![1]
    expect((await post(token,'approve','https://attacker.test')).status).toBe(403)
    expect((await post(token+'invalid')).status).toBe(400)
    state.identity='another-identity'
    expect((await post(token)).status).toBe(401)
    state.cookie.clear()
    expect((await post(token)).status).toBe(400)
    expect(state.issue).not.toHaveBeenCalled()
  })
  it('denial returns access_denied and stale verification requires login', async () => {
    const {html}=await consentToken();const token=html.match(/name="consent" value="([^"]+)"/)![1]
    expect((await post(token,'deny')).headers.get('location')).toContain('error=access_denied')
    expect(state.issue).not.toHaveBeenCalled()
    state.verifiedAt=new Date(Date.now()-25*3600000)
    expect((await GET(new Request(url()))).headers.get('location')).toContain('/identity?continue=')
  })
})
