import { describe, expect, it } from 'vitest'
import {
  draftStorageColumns,
  isDraftId,
  MAX_DRAFT_CIPHERTEXT_LENGTH,
  parseDraftStorageFields,
} from './draft-storage'

const envelope = JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'aaaa', ct: 'bbbb' })

describe('parseDraftStorageFields', () => {
  it('reads an encrypted draft', () => {
    const parsed = parseDraftStorageFields({ encryption: 'v1', ciphertext: envelope })

    expect(parsed).toEqual({ ok: true, fields: { encryption: 'v1', ciphertext: envelope } })
  })

  it('reads a plaintext draft', () => {
    const parsed = parseDraftStorageFields({
      title: 'A title',
      subtitle: 'A subtitle',
      content: { html: '<p>Body</p>' },
    })

    expect(parsed).toEqual({
      ok: true,
      fields: {
        encryption: 'none',
        title: 'A title',
        subtitle: 'A subtitle',
        content: { html: '<p>Body</p>' },
      },
    })
  })

  it('treats a missing subtitle as absent rather than empty', () => {
    const parsed = parseDraftStorageFields({ title: 'A title', content: { html: '<p>Body</p>' } })

    expect(parsed).toMatchObject({ ok: true, fields: { subtitle: null } })
  })

  it('refuses an encrypted draft that also carries prose', () => {
    for (const leak of [{ title: 'A title' }, { subtitle: 'A subtitle' }, { content: { html: '<p>x</p>' } }]) {
      expect(parseDraftStorageFields({ encryption: 'v1', ciphertext: envelope, ...leak }))
        .toEqual({ ok: false, message: 'Encrypted drafts must not carry plaintext' })
    }
  })

  it('accepts explicit nulls for the plaintext columns of an encrypted draft', () => {
    const parsed = parseDraftStorageFields({
      encryption: 'v1',
      ciphertext: envelope,
      title: null,
      subtitle: null,
      content: null,
    })

    expect(parsed).toMatchObject({ ok: true })
  })

  it('refuses an encrypted draft with no ciphertext', () => {
    expect(parseDraftStorageFields({ encryption: 'v1' }))
      .toEqual({ ok: false, message: 'Encrypted drafts require ciphertext' })
    expect(parseDraftStorageFields({ encryption: 'v1', ciphertext: '' }))
      .toEqual({ ok: false, message: 'Encrypted drafts require ciphertext' })
  })

  it('refuses an unbounded ciphertext', () => {
    const parsed = parseDraftStorageFields({
      encryption: 'v1',
      ciphertext: 'x'.repeat(MAX_DRAFT_CIPHERTEXT_LENGTH + 1),
    })

    expect(parsed).toEqual({ ok: false, message: 'Draft is too large' })
  })

  it('refuses an unknown encryption', () => {
    expect(parseDraftStorageFields({ encryption: 'v2', ciphertext: envelope }))
      .toEqual({ ok: false, message: 'Unsupported draft encryption' })
  })

  it('refuses a plaintext draft that is missing its parts', () => {
    expect(parseDraftStorageFields({ content: { html: '' } }))
      .toEqual({ ok: false, message: 'Draft title is required' })
    expect(parseDraftStorageFields({ title: 'A title' }))
      .toEqual({ ok: false, message: 'Draft content is required' })
    expect(parseDraftStorageFields({ title: 'A title', subtitle: 7, content: { html: '' } }))
      .toEqual({ ok: false, message: 'Draft subtitle must be a string' })
  })
})

describe('draftStorageColumns', () => {
  it('leaves no plaintext column set for an encrypted draft', () => {
    expect(draftStorageColumns({ encryption: 'v1', ciphertext: envelope })).toEqual({
      title: null,
      subtitle: null,
      content: null,
      ciphertext: envelope,
      encryption: 'v1',
    })
  })

  it('leaves no ciphertext column set for a plaintext draft', () => {
    expect(draftStorageColumns({
      encryption: 'none',
      title: 'A title',
      subtitle: null,
      content: { html: '<p>Body</p>' },
    })).toEqual({
      title: 'A title',
      subtitle: null,
      content: { html: '<p>Body</p>' },
      ciphertext: null,
      encryption: 'none',
    })
  })
})

describe('isDraftId', () => {
  it('accepts a UUID in either case', () => {
    expect(isDraftId('d109b298-4dda-4030-a7ac-9e3481cd840a')).toBe(true)
    expect(isDraftId('D109B298-4DDA-4030-A7AC-9E3481CD840A')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isDraftId('new')).toBe(false)
    expect(isDraftId('d109b298-4dda-4030-a7ac')).toBe(false)
    expect(isDraftId(undefined)).toBe(false)
    expect(isDraftId(7)).toBe(false)
  })
})
