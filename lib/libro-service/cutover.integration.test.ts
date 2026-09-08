import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'

const test = vi.hoisted(() => {
  const url = process.env.LIBRO_TEST_DATABASE_URL
  const schema = `p1_memorioso_${process.pid}`
  if (url) { const scoped = new URL(url); scoped.searchParams.set('options', `-c search_path=${schema},public`); process.env.DATABASE_URL = scoped.toString() }
  return { url, schema, user: { id: 0, handle:'ada' }, service:vi.fn() }
})
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: async () => test.user }))
vi.mock('@/lib/libro-service/token-store', () => ({ getLibroAccessToken: async () => 'oauth-token' }))
vi.mock('@/lib/libro-service/client', () => ({ serviceUserRequest:test.service }))
import { pool } from '@/lib/db'
import { POST as createConnection } from '@/app/api/extension/auth/connect/route'
import { GET as consentPage, POST as approveConnection } from '@/app/api/extension/auth/connect/[id]/route'
import { POST as pollConnection } from '@/app/api/extension/auth/connect/[id]/token/route'
import { PATCH as updateProfile } from '@/app/api/author/[authorId]/route'

let admin:Pool
let authorId:string
const request=(url:string,body?:URLSearchParams,origin='https://memorioso.test')=>new NextRequest(url,{method:body?'POST':'GET',headers:{Origin:origin},...(body?{body}: {})})
describe.skipIf(!test.url)('Memorioso cutover with Postgres',()=>{
  beforeAll(async()=>{
    admin=new Pool({connectionString:test.url})
    await admin.query(`CREATE SCHEMA ${test.schema}`)
    await pool.query(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'))
    process.env.LIBRO_SERVICE_WRITES_ENABLED='1';process.env.NEXT_PUBLIC_APP_URL='https://memorioso.test';process.env.SESSION_SECRET='test-session-secret-at-least-thirty-two-bytes'
    test.user.id=(await pool.query("INSERT INTO users (handle,libro_identity_status,libro_identity_id) VALUES ('ada','legacy',$1) RETURNING id",[randomUUID()])).rows[0].id
    authorId=randomUUID()
    await pool.query(`INSERT INTO authors (id,"userId",name,handle) VALUES ($1,$2,'Ada','ada')`,[authorId,test.user.id])
  })
  afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${test.schema} CASCADE`);await admin.end()})
  it('repairs the shadow-copy gap and synchronizes subsequent legacy publications and prices',async()=>{
    await pool.query('DROP TRIGGER sync_legacy_publication_policy ON publications')
    const id=(await pool.query(`INSERT INTO publications ("userId","authorId",title,content,signal,proof,version,access,access_price_usd,date)
      VALUES ($1,$2,'Legacy','{}','{}',$3,'1','gated',0.05,CURRENT_TIMESTAMP) RETURNING id`,[test.user.id,authorId,{signal_hash:`0x${'a'.repeat(64)}`}])).rows[0].id
    await pool.query(await readFile(new URL('../db/migrations/021_libro_legacy_policy_sync.sql',import.meta.url),'utf8'))
    expect((await pool.query('SELECT access FROM publication_policies WHERE publication_id=$1',[id])).rows[0].access).toBe('gated')
    await pool.query('UPDATE publications SET access_price_usd=0.25 WHERE id=$1',[id])
    expect(Number((await pool.query('SELECT access_price_usd FROM publication_policies WHERE publication_id=$1',[id])).rows[0].access_price_usd)).toBe(0.25)
    await pool.query(`INSERT INTO publications ("userId","authorId",title,content,signal,proof,version,date) VALUES ($1,$2,'Next','{}','{}',$3,'1',CURRENT_TIMESTAMP)`,[test.user.id,authorId,{signal_hash:`0x${'b'.repeat(64)}`}])
    const policies = (await pool.query('SELECT * FROM publication_policies ORDER BY publication_id')).rows
    expect(policies).toHaveLength(2)
    await pool.query(`INSERT INTO publication_access_grants
      ("publicationId",payer_address,scheme,network,asset_address,amount,valid_before,authorization_nonce,token_hash)
      VALUES ($1,'payer','exact','eip155:480','asset',250000,CURRENT_TIMESTAMP + INTERVAL '1 hour','nonce','token')`, [policies[1].publication_id])
    expect((await pool.query('SELECT * FROM publication_access_grants')).rows).toHaveLength(1)
  })
  it('mints an extension session only after browser consent, bound to the polling secret',async()=>{
    const started=await (await createConnection()).json()
    const context={params:Promise.resolve({id:started.id})}
    const tokenRequest=(token:string)=>new NextRequest('https://memorioso.test/token',{method:'POST',headers:{Authorization:`Bearer ${token}`}})
    expect((await pollConnection(tokenRequest('x'.repeat(43)),context)).status).toBe(401)
    expect((await pollConnection(tokenRequest(started.pollToken),context)).status).toBe(202)
    const html=await (await consentPage(request('https://memorioso.test/connect'),context)).text()
    const csrf=html.match(/name="csrf" value="([^"]+)"/)![1]
    expect((await approveConnection(request('https://memorioso.test/connect',new URLSearchParams({csrf}),'https://attacker.test'),context)).status).toBe(403)
    expect((await approveConnection(request('https://memorioso.test/connect',new URLSearchParams({csrf})),context)).status).toBe(200)
    const result=await (await pollConnection(tokenRequest(started.pollToken),context)).json()
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await pool.query('SELECT "userId" FROM libro_extension_sessions')).rows[0].userId).toBe(test.user.id)
    expect((await (await pollConnection(tokenRequest(started.pollToken),context)).json()).token).toBe(result.token)
  })
  it('updates canonical profile first and scopes updates to the owned author',async()=>{
    test.service.mockResolvedValue({author:{id:authorId,name:'Ada Updated',bio:'Bio',handle:'ada'}})
    const req=()=>new NextRequest('https://memorioso.test/profile',{method:'PATCH',body:JSON.stringify({name:'Ada Updated',bio:'Bio'})})
    expect((await updateProfile(req(),{params:Promise.resolve({authorId:randomUUID()})})).status).toBe(404)
    expect(test.service).not.toHaveBeenCalled()
    expect((await updateProfile(req(),{params:Promise.resolve({authorId})})).status).toBe(200)
    expect(test.service).toHaveBeenCalledWith(test.user.id,'profile','/api/v1/me','PATCH',{name:'Ada Updated',bio:'Bio'})
    expect((await pool.query('SELECT name FROM authors WHERE id=$1',[authorId])).rows[0].name).toBe('Ada Updated')
  })
})
