import { describe, it, expect, beforeEach, vi } from 'vitest'
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/db', () => ({ pool: {query:db.query, connect:db.connect} }))
import { findSettledGrantByToken, publicationAccessFamily, refreshTokenForSettledPayer } from './grants'
beforeEach(() => {
  db.query.mockReset().mockResolvedValue({rows:[{id:'1',root_id:'1'},{id:'2',root_id:'1'}]})
  db.clientQuery.mockReset().mockResolvedValue({rows:[{id:'grant',payer_address:'payer',transaction_hash:'tx'}]})
  db.connect.mockReset().mockResolvedValue({query:db.clientQuery,release:db.release})
  db.release.mockReset()
})
describe('family payment access', () => {
  it('accepts an original version token when viewing its later revision', async () => {
    expect(await findSettledGrantByToken('2','original-token')).toMatchObject({id:'grant'})
    expect(db.clientQuery).toHaveBeenCalledWith(expect.stringContaining('ANY($1::bigint[])'),[['1','2'],expect.any(String)])
    expect(db.release).toHaveBeenCalledOnce()
    expect(db.query.mock.invocationCallOrder[0]).toBeLessThan(db.connect.mock.invocationCallOrder[0])
  })
  it('refreshes a settled purchase across versions without rewriting its original publication id', async () => {
    expect(await refreshTokenForSettledPayer('2','PAYER')).toEqual(expect.any(String))
    const [sql,values] = db.clientQuery.mock.calls[0]
    expect(sql).toContain('ANY($1::bigint[])')
    expect(sql).not.toContain('SET "publicationId"')
    expect(values[0]).toEqual(['1','2']); expect(values[1]).toBe('payer')
  })
  it('supports local publishing families as well as service projections', async () => {
    db.query.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'4',root_id:'4'},{id:'5',root_id:'4'}]})
    expect(await publicationAccessFamily('5')).toEqual({rootId:'4',ids:['4','5']})
  })
})
