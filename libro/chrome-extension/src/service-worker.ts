import { formatLibroTextTag } from '@libro/core'
import { verifyCandidate } from './verifier'
import type { LibroCandidate, LibroVerificationResult, ScanResponse } from './shared'

const MAX_MANIFEST_BYTES = 1_000_000
const API_ORIGIN = (import.meta.env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz').replace(/\/$/, '')
const TOKEN_KEY = 'libroExtensionToken'
const SESSION_KEY = 'libroExtensionSession'
const CAPTURE_KEY = 'libroSigningCapture'
const JOB_KEY = 'libroSigningJob'

type StoredCapture = {
  tabId: number
  operationId?: string
  text: string
  canReplace: boolean
  message?: string
}

type SigningJob = {
  draftId: string
  signingId: string
  challengeId: string
  normalizedText: string
  author: { id: string; name: string; handle: string }
  context: Record<string, unknown>
  stage: 'proof' | 'prepared' | 'relayed' | 'finalized'
  registrationId?: string
  transactionHash?: string
  publicationId?: string
  tag?: string
}

function isSafeManifestUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  } catch {
    return false
  }
}

async function resolveTextManifest(candidate: LibroCandidate): Promise<LibroCandidate> {
  if (candidate.kind !== 'text' || candidate.manifestText || candidate.error) return candidate
  if (!candidate.manifestUrl) return candidate
  if (!isSafeManifestUrl(candidate.manifestUrl)) {
    return { ...candidate, error: 'The text tag manifest URL must use HTTPS' }
  }

  try {
    const response = await fetch(candidate.manifestUrl, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    })
    if (!response.ok) return { ...candidate, error: `The text tag manifest returned HTTP ${response.status}` }
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_MANIFEST_BYTES) return { ...candidate, error: 'The text tag manifest is too large' }
    const manifestText = await response.text()
    if (manifestText.length > MAX_MANIFEST_BYTES) return { ...candidate, error: 'The text tag manifest is too large' }
    return { ...candidate, manifestText }
  } catch {
    return { ...candidate, error: 'The text tag manifest could not be retrieved' }
  }
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (typeof tab?.id !== 'number') throw new Error('No active webpage is available')
  return tab.id
}

function setToolbarBadge(results: LibroVerificationResult[]): void {
  const verified = results.filter((item) => item.status === 'verified').length
  const hasProblems = results.some((item) => !['verified', 'network_unavailable'].includes(item.status))
  const text = verified > 0 ? String(verified) : hasProblems ? '!' : results.length === 0 ? '0' : '?'
  const color = verified > 0 ? '#15803d' : hasProblems ? '#b91c1c' : '#71717a'
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined)
  chrome.action.setBadgeText({ text }).catch(() => undefined)
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
}

async function scanActiveTab(): Promise<ScanResponse> {
  try {
    const tabId = await activeTabId()
    await ensureContentScript(tabId)
    const scanResult = await chrome.tabs.sendMessage(tabId, { type: 'LIBRO_SCAN_PAGE' }) as { candidates?: LibroCandidate[] }
    const discoveredCandidates = Array.isArray(scanResult?.candidates) ? scanResult.candidates : []
    const candidates = await Promise.all(discoveredCandidates.map(resolveTextManifest))
    let results = await Promise.all(candidates.map((candidate) => verifyCandidate(candidate)))
    const applied = await chrome.tabs.sendMessage(tabId, {
      type: 'LIBRO_APPLY_RESULTS',
      results,
      candidates,
    }).catch(() => null) as { staleBlockIds?: string[] } | null
    const staleBlockIds = new Set(applied?.staleBlockIds || [])
    if (staleBlockIds.size > 0) {
      results = results.map((result) => staleBlockIds.has(result.blockId)
        ? { ...result, status: 'stale', label: 'Changed — rescan', detail: 'The page changed while verification was running' }
        : result)
    }
    setToolbarBadge(results)
    return { success: true, results }
  } catch (error) {
    chrome.action.setBadgeText({ text: '' }).catch(() => undefined)
    return {
      success: false,
      results: [],
      message: error instanceof Error ? error.message : 'This page cannot be scanned',
    }
  }
}

async function captureActiveText(requestedTabId?: number): Promise<StoredCapture> {
  const tabId = requestedTabId ?? await activeTabId()
  try {
    await ensureContentScript(tabId)
    const result = await chrome.tabs.sendMessage(tabId, { type: 'LIBRO_CAPTURE_TEXT' }) as {
      success?: boolean
      operationId?: string
      text?: string
      canReplace?: boolean
      message?: string
    }
    const capture: StoredCapture = {
      tabId,
      operationId: result.operationId,
      text: result.success && typeof result.text === 'string' ? result.text : '',
      canReplace: result.success === true && result.canReplace === true,
      message: result.message,
    }
    await chrome.storage.local.set({ [CAPTURE_KEY]: capture })
    return capture
  } catch (error) {
    const capture: StoredCapture = {
      tabId,
      text: '',
      canReplace: false,
      message: error instanceof Error ? error.message : 'Text could not be captured from this page',
    }
    await chrome.storage.local.set({ [CAPTURE_KEY]: capture })
    return capture
  }
}

async function openSigningPanel(requestedTabId?: number): Promise<StoredCapture> {
  const tabId = requestedTabId ?? await activeTabId()
  const opening = chrome.sidePanel.open({ tabId })
  const capture = await captureActiveText(tabId)
  await opening
  return capture
}

async function apiFetch<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  if (authenticated) {
    const stored = await chrome.storage.local.get(TOKEN_KEY)
    const token = stored[TOKEN_KEY]
    if (typeof token !== 'string') throw new Error('Connect your Memorioso author first')
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    credentials: 'omit',
  })
  const body = await response.json().catch(() => ({})) as T & { message?: string }
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      await chrome.storage.local.remove([TOKEN_KEY, SESSION_KEY])
    }
    throw new Error(body.message || `Memorioso returned HTTP ${response.status}`)
  }
  return body
}

async function currentState(): Promise<Record<string, unknown>> {
  const stored = await chrome.storage.local.get([SESSION_KEY, CAPTURE_KEY, JOB_KEY])
  let job = stored[JOB_KEY] as SigningJob | undefined
  if (job && typeof stored[SESSION_KEY] === 'object') {
    try {
      const recovery = await apiFetch<{
        stage: 'challenge' | 'prepared' | 'registered' | 'finalized'
        registrationId?: string
        transactionHash?: string
        publicationId?: string
      }>(`/api/extension/signatures/${job.signingId}`)
      job = {
        ...job,
        stage: recovery.stage === 'challenge'
          ? 'proof'
          : recovery.stage === 'registered'
            ? 'relayed'
            : recovery.stage,
        registrationId: recovery.registrationId || job.registrationId,
        transactionHash: recovery.transactionHash || job.transactionHash,
        publicationId: recovery.publicationId || job.publicationId,
      }
      await chrome.storage.local.set({ [JOB_KEY]: job })
    } catch {
      // Cached state remains useful when the API is temporarily unavailable.
    }
  }
  return {
    session: stored[SESSION_KEY] || null,
    capture: stored[CAPTURE_KEY] || null,
    job: job || null,
    apiOrigin: API_ORIGIN,
  }
}

async function handleMessage(message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case 'LIBRO_SCAN_ACTIVE_TAB':
      return scanActiveTab()
    case 'LIBRO_START_SIGNING':
      return { success: true, capture: await openSigningPanel() }
    case 'LIBRO_CAPTURE_ACTIVE_TEXT':
      return { success: true, capture: await captureActiveText() }
    case 'LIBRO_GET_SIGNING_STATE':
      return { success: true, ...(await currentState()) }
    case 'LIBRO_AUTH_CONTEXT':
      return apiFetch('/api/extension/auth/context', {
        method: 'POST',
        body: JSON.stringify({ handle: message.handle }),
      }, false)
    case 'LIBRO_AUTH_VERIFY': {
      const response = await apiFetch<{ token: string; user: unknown; expiresAt: string }>(
        '/api/extension/auth/verify',
        { method: 'POST', body: JSON.stringify({ attemptId: message.attemptId, idkitResult: message.idkitResult }) },
        false
      )
      await chrome.storage.local.set({
        [TOKEN_KEY]: response.token,
        [SESSION_KEY]: { user: response.user, expiresAt: response.expiresAt },
      })
      return { success: true, user: response.user, expiresAt: response.expiresAt }
    }
    case 'LIBRO_AUTH_SESSION': {
      const response = await apiFetch<{ user: unknown; expiresAt: string }>('/api/extension/auth/session')
      await chrome.storage.local.set({ [SESSION_KEY]: response })
      return { success: true, ...response }
    }
    case 'LIBRO_AUTH_LOGOUT':
      await apiFetch('/api/extension/auth/session', { method: 'DELETE' }).catch(() => undefined)
      await chrome.storage.local.remove([TOKEN_KEY, SESSION_KEY, JOB_KEY])
      return { success: true }
    case 'LIBRO_CREATE_SIGNATURE': {
      const response = await apiFetch<Record<string, unknown>>('/api/extension/signatures', {
        method: 'POST',
        body: JSON.stringify({ text: message.text }),
      })
      const job: SigningJob = {
        draftId: response.draftId as string,
        signingId: response.signingId as string,
        challengeId: response.challengeId as string,
        normalizedText: response.normalizedText as string,
        author: response.author as SigningJob['author'],
        context: response,
        stage: 'proof',
      }
      await chrome.storage.local.set({ [JOB_KEY]: job })
      return { success: true, job }
    }
    case 'LIBRO_PREPARE_SIGNATURE': {
      const stored = await chrome.storage.local.get(JOB_KEY)
      const job = stored[JOB_KEY] as SigningJob | undefined
      if (!job) throw new Error('No inline signing request is active')
      const response = await apiFetch<{ registrationId: string }>(`/api/draft/${job.draftId}/publish/prepare`, {
        method: 'PUT',
        body: JSON.stringify({ challengeId: job.challengeId, idkitResult: message.idkitResult }),
      })
      const next = { ...job, stage: 'prepared' as const, registrationId: response.registrationId }
      await chrome.storage.local.set({ [JOB_KEY]: next })
      return { success: true, job: next }
    }
    case 'LIBRO_RELAY_SIGNATURE': {
      const stored = await chrome.storage.local.get(JOB_KEY)
      const job = stored[JOB_KEY] as SigningJob | undefined
      if (!job?.registrationId) throw new Error('The Libro registration has not been prepared')
      const response = await apiFetch<{ transactionHash: string; publicationId?: string }>(`/api/draft/${job.draftId}/publish/relay`, {
        method: 'PUT',
        body: JSON.stringify({ registrationId: job.registrationId }),
      })
      const next = {
        ...job,
        stage: response.publicationId ? 'finalized' as const : 'relayed' as const,
        transactionHash: response.transactionHash,
        publicationId: response.publicationId,
      }
      await chrome.storage.local.set({ [JOB_KEY]: next })
      return { success: true, job: next }
    }
    case 'LIBRO_FINALIZE_SIGNATURE': {
      const stored = await chrome.storage.local.get(JOB_KEY)
      const job = stored[JOB_KEY] as SigningJob | undefined
      if (!job?.registrationId || !job.transactionHash) throw new Error('The Libro registration has not been relayed')
      const response = await apiFetch<{ publicationId: string }>(`/api/draft/${job.draftId}/publish/finalize`, {
        method: 'PUT',
        body: JSON.stringify({
          registrationId: job.registrationId,
          submissionMethod: 'memorioso_relayer',
          transactionHash: job.transactionHash,
        }),
      })
      const manifest = await apiFetch<unknown>(`/api/publications/${response.publicationId}/libro-manifest`, {}, false)
      const tag = formatLibroTextTag(manifest)
      const next = { ...job, stage: 'finalized' as const, publicationId: response.publicationId, tag }
      await chrome.storage.local.set({ [JOB_KEY]: next })
      return {
        success: true,
        job: next,
        publicationUrl: `${API_ORIGIN}/p/${response.publicationId}`,
      }
    }
    case 'LIBRO_INSERT_TAG': {
      const stored = await chrome.storage.local.get([CAPTURE_KEY, JOB_KEY])
      const capture = stored[CAPTURE_KEY] as StoredCapture | undefined
      const job = stored[JOB_KEY] as SigningJob | undefined
      if (!capture || !job?.tag) throw new Error('No completed Libro signature is available')
      if (!capture.operationId || !capture.canReplace) {
        return { success: true, inserted: false, tag: job.tag, message: 'The signed tag was copied because the source was not editable' }
      }
      const result = await chrome.tabs.sendMessage(capture.tabId, {
        type: 'LIBRO_REPLACE_CAPTURE',
        operationId: capture.operationId,
        replacement: job.tag,
      }).catch(() => null) as { success?: boolean; message?: string } | null
      return {
        success: true,
        inserted: result?.success === true,
        tag: job.tag,
        message: result?.message,
      }
    }
    case 'LIBRO_CANCEL_SIGNATURE': {
      const stored = await chrome.storage.local.get(JOB_KEY)
      const job = stored[JOB_KEY] as SigningJob | undefined
      if (job && job.stage === 'proof') {
        await apiFetch(`/api/extension/signatures/${job.signingId}`, { method: 'DELETE' }).catch(() => undefined)
      }
      await chrome.storage.local.remove(JOB_KEY)
      return { success: true }
    }
    default:
      throw new Error('Unsupported extension request')
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll().then(() => chrome.contextMenus.create({
    id: 'libro-sign-text',
    title: 'Sign with Libro',
    contexts: ['selection', 'editable'],
  })).catch(() => undefined)
})

chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (typeof tab?.id === 'number') openSigningPanel(tab.id).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const typed = message as Record<string, unknown>
  if (typed.type === 'LIBRO_RESULT_STALE') {
    chrome.action.setBadgeBackgroundColor({ color: '#b45309' }).catch(() => undefined)
    chrome.action.setBadgeText({ text: '?' }).catch(() => undefined)
    return
  }
  if (typeof typed.type === 'string' && typed.type.startsWith('LIBRO_')) {
    handleMessage(typed)
      .then(sendResponse)
      .catch((error) => sendResponse({
        success: false,
        message: error instanceof Error ? error.message : 'The extension request failed',
      }))
    return true
  }
})
