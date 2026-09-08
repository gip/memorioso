import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: { query } }))
import { GET } from './route'

const lookup = (handle: string) => GET(new Request(`https://libro.test/api/v1/identity/handle?handle=${encodeURIComponent(handle)}`))

describe('identity handle selection', () => {
  beforeEach(() => { query.mockReset() })

  it('rejects invalid names without querying the database', async () => {
    const response = await lookup('ab')
    expect(await response.json()).toMatchObject({ valid: false, exists: false, canLogin: false })
    expect(query).not.toHaveBeenCalled()
  })

  it('normalizes an available name for signup', async () => {
    query.mockResolvedValue({ rows: [] })
    const response = await lookup(' Alice_Name ')
    expect(await response.json()).toEqual({ success: true, valid: true, exists: false, canLogin: false })
    expect(query).toHaveBeenCalledWith(expect.any(String), ['alice_name'])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([
    ['identity-1', true],
    [null, false],
  ])('only offers login when the taken name has an active identity (%s)', async (identityId, canLogin) => {
    query.mockResolvedValue({ rows: [{ identity_id: identityId }] })
    expect(await (await lookup('alice')).json()).toMatchObject({ valid: true, exists: true, canLogin })
    expect(query.mock.calls[0][0]).toContain('i.revoked_at IS NULL')
  })

  it('does not advertise availability when the lookup fails', async () => {
    query.mockRejectedValue(new Error('database unavailable'))
    const response = await lookup('alice')
    expect(response.status).toBe(500)
    expect(await response.json()).not.toHaveProperty('exists')
  })
})
