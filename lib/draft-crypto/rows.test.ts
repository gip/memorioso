import { describe, expect, it } from 'vitest'
import { encryptDraft, generateDekBytes, importDek } from '@/lib/draft-crypto'
import { LOCKED_DRAFT_TITLE, revealDraftRow, revealDraftRows } from '@/lib/draft-crypto/rows'

const DRAFT_ID = '0f1c8f6e-2a1b-4a3d-9c7e-5b2f8a1d4c60'
const USER_ID = 42

const plaintext = {
  title: 'The salt marsh in November',
  subtitle: 'Notes from a cold walk',
  content: { html: '<p>The tide was out.</p>' },
}

const keyFor = () => importDek(generateDekBytes())

const encryptedRow = async (key: CryptoKey, id = DRAFT_ID, userId = USER_ID) => ({
  id,
  encryption: 'v1',
  ciphertext: await encryptDraft(key, { draftId: id, userId }, plaintext),
  title: null,
  subtitle: null,
  content: null,
  publicationType: 'article' as const,
})

describe('revealDraftRow', () => {
  it('decrypts an encrypted row', async () => {
    const key = await keyFor()

    const revealed = await revealDraftRow(await encryptedRow(key), key, USER_ID)

    expect(revealed).toMatchObject({ ...plaintext, locked: false, publicationType: 'article' })
  })

  it('passes a plaintext row through untouched', async () => {
    const revealed = await revealDraftRow({
      id: DRAFT_ID,
      encryption: 'none',
      title: 'Written before encryption',
      subtitle: null,
      content: { html: '<p>Body</p>' },
    }, await keyFor(), USER_ID)

    expect(revealed).toMatchObject({
      title: 'Written before encryption',
      subtitle: '',
      content: { html: '<p>Body</p>' },
      locked: false,
    })
  })

  it('treats a row with no encryption marker as plaintext', async () => {
    const revealed = await revealDraftRow({
      id: DRAFT_ID,
      title: 'Legacy row',
      content: { html: '<p>Body</p>' },
    }, null, USER_ID)

    expect(revealed).toMatchObject({ title: 'Legacy row', locked: false })
  })

  it('reports locked rather than failing when there is no key', async () => {
    const row = await encryptedRow(await keyFor())

    const revealed = await revealDraftRow(row, null, USER_ID)

    expect(revealed).toMatchObject({ locked: true, title: '', subtitle: '', content: { html: '' } })
  })

  it('reports locked when the key belongs to someone else', async () => {
    const row = await encryptedRow(await keyFor())

    const revealed = await revealDraftRow(row, await keyFor(), USER_ID)

    expect(revealed.locked).toBe(true)
  })

  it('reports locked when the row was sealed for another user', async () => {
    const key = await keyFor()
    const row = await encryptedRow(key, DRAFT_ID, 43)

    const revealed = await revealDraftRow(row, key, USER_ID)

    expect(revealed.locked).toBe(true)
  })

  it('never carries the ciphertext through to the caller', async () => {
    const key = await keyFor()

    const revealed = await revealDraftRow(await encryptedRow(key), key, USER_ID)

    expect(revealed).not.toHaveProperty('ciphertext')
  })

  it('reveals a whole list, locking only what it cannot read', async () => {
    const key = await keyFor()
    const other = await keyFor()

    const revealed = await revealDraftRows([
      await encryptedRow(key, DRAFT_ID),
      await encryptedRow(other, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    ], key, USER_ID)

    expect(revealed.map((row) => row.locked)).toEqual([false, true])
    expect(revealed[0].title).toBe(plaintext.title)
  })
})

describe('LOCKED_DRAFT_TITLE', () => {
  it('is what a list can show in place of an unreadable title', () => {
    expect(LOCKED_DRAFT_TITLE).toBe('Locked draft')
  })
})
