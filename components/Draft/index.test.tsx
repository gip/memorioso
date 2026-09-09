// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Draft } from './index'

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  user: { id: 1 },
  keyStatus: 'disabled',
  edit: null as null | ((title: string) => void),
}))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
vi.mock('@/lib/world-id/client-auth', () => ({
  useWorldIdAuth: () => ({ status: 'authenticated', user: mocks.user }),
}))
vi.mock('@/lib/draft-crypto/provider', () => ({
  useDraftKey: () => ({ status: mocks.keyStatus, key: null }),
}))
vi.mock('@worldcoin/minikit-js/minikit-provider', () => ({ useMiniKit: () => ({ isInstalled: false }) }))
vi.mock('@worldcoin/minikit-react', () => ({ useUserOperationReceipt: () => ({}) }))
vi.mock('@worldcoin/idkit', () => ({ CredentialRequest: vi.fn(), IDKitSessionWidget: () => null }))
vi.mock('@/components/Editor', () => ({
  default: ({ setTitle }: { setTitle: (title: string) => void }) => { mocks.edit = setTitle; return null },
}))
vi.mock('@/components/DraftPassphrase', () => ({ DraftEncryptionSetup: () => null }))

const storedDraft = {
  id: 'draft-1', title: 'Existing title', subtitle: '', content: { html: '<p>Existing prose</p>' },
  authorId: 'author-1', publicationType: 'article', access: 'public', status: 'draft', encryption: 'none',
}
const fetcher = vi.fn()
let resolveAuthors: (response: Response) => void
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetcher)
  localStorage.clear()
  mocks.keyStatus = 'disabled'
  mocks.edit = null
  fetcher.mockReset()
  const authors = new Promise<Response>((resolve) => { resolveAuthors = resolve })
  fetcher.mockImplementation((url: string, options?: RequestInit) => {
    if (url === '/api/authors') return authors
    if (options?.method === 'PUT') return Promise.resolve(Response.json({ success: true, draft: storedDraft }))
    return Promise.resolve(Response.json({ success: true, data: storedDraft }))
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => root.render(<Draft draftId="draft-1" initialType={null} />))
}

async function loadAuthors() {
  await act(async () => resolveAuthors(Response.json({ success: true, authors: [{ id: 'author-1', name: 'Author', handle: 'author' }] })))
}

const writes = () => fetcher.mock.calls.filter(([, options]) => options?.method === 'PUT')

it('does not start saving an untouched draft while the login author is loading', async () => {
  await mount()
  expect(container.textContent).not.toContain('Saving')
  await loadAuthors()
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
  expect(container.textContent).not.toContain('Saving')
  expect(writes()).toHaveLength(0)
  expect(localStorage.length).toBe(0)
})

it('saves edits made before the author finishes loading without a refresh', async () => {
  await mount()
  await act(async () => mocks.edit!('Changed title'))
  await loadAuthors()
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
  expect(writes()).toHaveLength(1)
  expect(JSON.parse(writes()[0][1].body).title).toBe('Changed title')
  expect(container.textContent).not.toContain('Saving')
})

it('clears the saving indicator when an edit is reverted before the debounce fires', async () => {
  await mount()
  await loadAuthors()
  await act(async () => mocks.edit!('Changed title'))
  expect(container.textContent).toContain('Saving')
  await act(async () => mocks.edit!(storedDraft.title))
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
  expect(container.textContent).not.toContain('Saving')
  expect(writes()).toHaveLength(0)
})
