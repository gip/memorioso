import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn() }))
vi.mock('./db', () => ({ pool: { query: mocks.query } }))
vi.mock('@libro/core', async original => ({ ...await original<object>(), readLibroRevisionStatus: mocks.read }))
import { persistRevisionProjection, validatePublicationRevision, publicationRevisionStatus, revisionInfo } from './revisions'
const vector = JSON.parse(readFileSync(new URL('../../core/fixtures/publication-v2-vectors.json', import.meta.url), 'utf8'))[1]
const publication = vector.publication
const predecessor = { id: '1', root_publication_id:'1', author_id:'author', authorship_class:'human', signal_hash:publication.previous_publication.signal_hash,
  title:publication.publication_title, date:publication.initially_published_at, initially_published_at:publication.initially_published_at, revision_number:1,
  signal:publication, proof:{libro_registration:{ registry_address:publication.previous_publication.registry_address }} }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS','0x1111111111111111111111111111111111111111')
  vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS','0x2222222222222222222222222222222222222222')
  mocks.query.mockReset().mockImplementation(async sql => sql.startsWith('SELECT *') ? {rows:[predecessor]} : {rows:[]})
  mocks.read.mockReset().mockResolvedValue({exists:true,isLatest:true,latest:{registry:publication.previous_publication.registry_address,signalHash:BigInt(publication.previous_publication.signal_hash)}})
})
afterEach(() => vi.unstubAllEnvs())
describe('publication revision authority and recovery', () => {
  it('preserves the original date and validates a v1 predecessor', async () => {
    await validatePublicationRevision(publication,'author')
    expect(mocks.read).toHaveBeenCalledWith(publication.previous_publication, process.env.LIBRO_RPC_URL)
  })
  it.each([
    ['another author',publication,'someone-else',false,403],
    ['agent replacing a human',publication,'author',true,403],
    ['changed type',{...publication,publication_title:''},'author',false,400],
    ['changed original date',{...publication,initially_published_at:publication.publication_date},'author',false,400],
    ['wrong revision',{...publication,revision_number:3},'author',false,400],
  ])('rejects %s', async (_label, value, author, agent, status) => {
    await expect(validatePublicationRevision(value,author,agent)).rejects.toMatchObject({status})
  })
  it('rejects a stale predecessor with a conflict', async () => {
    mocks.read.mockResolvedValue({exists:true,isLatest:false})
    await expect(validatePublicationRevision(publication,'author')).rejects.toMatchObject({status:409,code:'REVISION_CONFLICT'})
  })
  it('fails closed if the current head cannot be confirmed', async () => {
    mocks.read.mockRejectedValue(new Error('RPC unavailable'))
    await expect(validatePublicationRevision(publication,'author')).rejects.toMatchObject({status:503})
  })
  it('finalizes a frozen registered update without asking whether it is still the head', async () => {
    const revision = await persistRevisionProjection({query:mocks.query},'2',publication)
    expect(revision).toEqual({rootPublicationId:'1',previousPublicationId:'1',initiallyPublishedAt:publication.initially_published_at,revisionNumber:2})
    expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE libro_publications'),['2','1','1',publication.initially_published_at,2])
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('reports a registered successor with no finalized content as pending', async () => {
    mocks.read.mockResolvedValue({exists:true,isLatest:false,latest:{registry:publication.publication_registry,signalHash:123n}})
    const status = await publicationRevisionStatus('1')
    expect(status).toMatchObject({isLatest:false,pending:true,latestPublicationId:null})
    expect(status.latestReference.signal_hash).toBe(`0x${'7b'.padStart(64,'0')}`)
  })
  it('does not call an unconfirmed version latest when status is unavailable', async () => {
    mocks.read.mockRejectedValue(new Error('RPC unavailable'))
    expect(await revisionInfo(predecessor,true)).toMatchObject({isLatest:false,statusAvailable:false})
  })
})
