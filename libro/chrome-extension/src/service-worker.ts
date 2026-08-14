import { formatLibroTextTag } from '@libro/core'
import { autoScanPreference, hasAutoScanPermission, setAutoScan, syncAutoScan } from './auto-scan'
import { loadApprovedManifestOrigins } from './manifest-access'
import { resolveTextManifest } from './manifest-fetch'
import { enabledLibroRpcUrls, RPC_SETTINGS_KEY } from './rpc-settings'
import {
  isContentNotification,
  isTrustedContentSender,
  isTrustedExtensionPageSender,
  restrictExtensionStorageAccess,
} from './security'
import { verifyCandidate } from './verifier'
import { clearLibroVerificationCache, createCachedChainVerifier } from './verification-cache'
import { retryWithBackoff } from './retry'
import { isIndeterminateStatus, type LibroCandidate, type LibroVerificationResult, type ScanResponse } from './shared'

const API_ORIGIN = (import.meta.env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz').replace(/\/$/, '')
const TOKEN_KEY = 'libroExtensionToken'
const SESSION_KEY = 'libroExtensionSession'
const CAPTURE_KEY = 'libroSigningCapture'
const JOB_KEY = 'libroSigningJob'
const AUTO_KEY = 'libroAutoCapture'
const FOLLOW_KEY = 'libroFollowPages'
const SIGNING_JOB_VERSION = 1 as const

// local and sync are exposed to content scripts by default. All privileged work waits for this
// restriction, so a failure cannot silently fall back to page-readable credential storage.
const storageReady = restrictExtensionStorageAccess()

type StoredCapture = {
  tabId: number
  operationId?: string
  text: string
  canReplace: boolean
  message?: string
}

// Auto capture is armed for one tab: the activeTab grant it rides on does not survive navigation.
type AutoCaptureState = {
  enabled: boolean
  tabId: number
  reason?: 'navigated' | 'closed'
}

type SigningJob = {
  version: typeof SIGNING_JOB_VERSION
  draftId: string
  signingId: string
  challengeId: string
  normalizedText?: string
  author?: { id: string; name: string; handle: string }
  context?: Record<string, unknown>
  stage: 'proof' | 'prepared' | 'relayed' | 'finalized'
  registrationId?: string
  transactionHash?: string
  publicationId?: string
  tag?: string
}

class MemoriosoApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly retryable: boolean

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message)
    this.name = 'MemoriosoApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function isRetryableFinalizeFailure(error: unknown): boolean {
  if (error instanceof MemoriosoApiError) {
    return error.code === 'FINALIZE_RETRYABLE' && error.retryable
  }
  return error instanceof TypeError || (
    error instanceof DOMException && error.name === 'AbortError'
  )
}

function normalizedSigningJob(value: unknown): SigningJob | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (
    typeof raw.draftId !== 'string' || typeof raw.signingId !== 'string' ||
    typeof raw.challengeId !== 'string' ||
    !['proof', 'prepared', 'relayed', 'finalized'].includes(String(raw.stage))
  ) return undefined

  const job: SigningJob = {
    version: SIGNING_JOB_VERSION,
    draftId: raw.draftId,
    signingId: raw.signingId,
    challengeId: raw.challengeId,
    stage: raw.stage as SigningJob['stage'],
    ...(typeof raw.registrationId === 'string' ? { registrationId: raw.registrationId } : {}),
    ...(typeof raw.transactionHash === 'string' ? { transactionHash: raw.transactionHash } : {}),
    ...(typeof raw.publicationId === 'string' ? { publicationId: raw.publicationId } : {}),
  }
  if (job.stage === 'proof') {
    if (
      typeof raw.normalizedText !== 'string' || typeof raw.context !== 'object' || raw.context === null ||
      typeof raw.author !== 'object' || raw.author === null
    ) return undefined
    const author = raw.author as Record<string, unknown>
    if (typeof author.id !== 'string' || typeof author.name !== 'string' || typeof author.handle !== 'string') return undefined
    job.normalizedText = raw.normalizedText
    job.context = raw.context as Record<string, unknown>
    job.author = { id: author.id, name: author.name, handle: author.handle }
  }
  return job
}

function resumableSigningJob(job: SigningJob): SigningJob {
  return {
    version: SIGNING_JOB_VERSION,
    draftId: job.draftId,
    signingId: job.signingId,
    challengeId: job.challengeId,
    stage: job.stage,
    ...(job.registrationId ? { registrationId: job.registrationId } : {}),
    ...(job.transactionHash ? { transactionHash: job.transactionHash } : {}),
    ...(job.publicationId ? { publicationId: job.publicationId } : {}),
  }
}

async function saveSigningJob(job: SigningJob): Promise<void> {
  if (job.stage === 'proof') {
    const { tag: _tag, ...ephemeralJob } = job
    await Promise.all([
      chrome.storage.session.set({ [JOB_KEY]: { ...ephemeralJob, version: SIGNING_JOB_VERSION } }),
      chrome.storage.local.remove(JOB_KEY),
    ])
    return
  }
  await Promise.all([
    chrome.storage.local.set({ [JOB_KEY]: resumableSigningJob(job) }),
    chrome.storage.session.remove(JOB_KEY),
  ])
}

async function readSigningJob(): Promise<SigningJob | undefined> {
  const [ephemeral, persistent] = await Promise.all([
    chrome.storage.session.get(JOB_KEY),
    chrome.storage.local.get(JOB_KEY),
  ])
  const fromSession = normalizedSigningJob(ephemeral[JOB_KEY])
  const fromLocal = normalizedSigningJob(persistent[JOB_KEY])
  const job = fromSession || fromLocal
  if (!job) return undefined
  const source = fromSession ? ephemeral[JOB_KEY] : persistent[JOB_KEY]
  const sourceRecord = source as Record<string, unknown>
  const needsMigration = sourceRecord.version !== SIGNING_JOB_VERSION ||
    (job.stage === 'proof' && !fromSession) ||
    (job.stage !== 'proof' && (
      !fromLocal || 'normalizedText' in sourceRecord || 'author' in sourceRecord || 'context' in sourceRecord
    ))
  // Migrate legacy unversioned stage builds and strip proof material from local storage once.
  if (needsMigration) await saveSigningJob(job)
  return job
}

async function clearSigningJob(): Promise<void> {
  await Promise.all([
    chrome.storage.local.remove(JOB_KEY),
    chrome.storage.session.remove(JOB_KEY),
  ])
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (typeof tab?.id !== 'number') throw new Error('No active webpage is available')
  return tab.id
}

// Scoped to the tab it describes: automatic scanning verifies background tabs too, and a global
// badge would let whichever tab finished last speak for the one the reader is looking at.
function setToolbarBadge(tabId: number, results: LibroVerificationResult[]): void {
  if (results.length === 0) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => undefined)
    return
  }
  const verified = results.filter((item) => item.status === 'verified').length
  const hasProblems = results.some((item) => item.status !== 'verified' && !isIndeterminateStatus(item.status))
  const text = verified > 0 ? String(verified) : hasProblems ? '!' : '?'
  const color = verified > 0 ? '#15803d' : hasProblems ? '#b91c1c' : '#b45309'
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => undefined)
  chrome.action.setBadgeText({ text, tabId }).catch(() => undefined)
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
}

// A manual rescan arriving while an automatic scan is mid-flight joins it rather than starting a
// second pass over the same DOM, which would race the first one's decorations.
const scansInFlight = new Map<number, Promise<ScanResponse>>()
const automaticRescanTimers = new Map<number, ReturnType<typeof setTimeout>>()

async function runScan(tabId: number, inject: boolean): Promise<ScanResponse> {
  try {
    if (inject) await ensureContentScript(tabId)
    const scanResult = await chrome.tabs.sendMessage(tabId, { type: 'LIBRO_SCAN_PAGE' }) as { candidates?: LibroCandidate[] }
    const discoveredCandidates = Array.isArray(scanResult?.candidates) ? scanResult.candidates : []
    const [approvedOrigins, rpcUrls] = await Promise.all([
      loadApprovedManifestOrigins(),
      enabledLibroRpcUrls(),
    ])
    const candidates = await Promise.all(discoveredCandidates.map((candidate) => resolveTextManifest(candidate, {
      apiOrigin: API_ORIGIN,
      approvedOrigins,
    })))
    const verifyChain = createCachedChainVerifier(rpcUrls)
    let results = await Promise.all(candidates.map((candidate) => verifyCandidate(candidate, verifyChain)))
    const applied = await chrome.tabs.sendMessage(tabId, {
      type: 'LIBRO_APPLY_RESULTS',
      results,
      candidates,
    }).catch(() => null) as { staleBlockIds?: string[] } | null
    const staleBlockIds = new Set(applied?.staleBlockIds || [])
    if (staleBlockIds.size > 0) {
      results = results.map((result) => staleBlockIds.has(result.blockId)
        ? {
            ...result,
            status: 'stale',
            label: 'Changed',
            detail: 'The page changed while verification was running. Reopen the Libro popup to check it again.',
          }
        : result)
    }
    setToolbarBadge(tabId, results)
    return { success: true, results }
  } catch (error) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => undefined)
    return {
      success: false,
      results: [],
      message: error instanceof Error ? error.message : 'This page cannot be scanned',
    }
  }
}

function scanTab(tabId: number, inject: boolean): Promise<ScanResponse> {
  const existing = scansInFlight.get(tabId)
  if (existing) return existing
  const pending = runScan(tabId, inject).finally(() => {
    scansInFlight.delete(tabId)
  })
  scansInFlight.set(tabId, pending)
  return pending
}

async function scanActiveTab(): Promise<ScanResponse> {
  try {
    return await scanTab(await activeTabId(), true)
  } catch (error) {
    return {
      success: false,
      results: [],
      message: error instanceof Error ? error.message : 'This page cannot be scanned',
    }
  }
}

/**
 * A page that passed the content script's cheap pre-filter is offering itself for verification.
 * The offer is only taken up when automatic scanning is on; otherwise the reader's click is still
 * what decides that this page gets looked at and that its manifest URL gets fetched.
 */
async function scanAnnouncedPage(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== 'number') return
  if (!(await autoScanPreference())) return
  await scanTab(tabId, false)
}

async function scheduleAutomaticRescan(tabId: number): Promise<void> {
  if (!(await autoScanPreference())) return
  const previous = automaticRescanTimers.get(tabId)
  if (previous) clearTimeout(previous)
  automaticRescanTimers.set(tabId, setTimeout(() => {
    automaticRescanTimers.delete(tabId)
    scanTab(tabId, false).catch(() => undefined)
  }, 400))
}

async function captureActiveText(requestedTabId?: number, hintText?: string): Promise<StoredCapture> {
  const tabId = requestedTabId ?? await activeTabId()
  try {
    await ensureContentScript(tabId)
    const result = await chrome.tabs.sendMessage(tabId, { type: 'LIBRO_CAPTURE_TEXT', hintText }) as {
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
    await chrome.storage.session.set({ [CAPTURE_KEY]: capture })
    return capture
  } catch (error) {
    const capture: StoredCapture = {
      tabId,
      // A page the content script cannot reach still hands over the context-menu selection.
      text: hintText || '',
      canReplace: false,
      message: error instanceof Error ? error.message : 'Text could not be captured from this page',
    }
    await chrome.storage.session.set({ [CAPTURE_KEY]: capture })
    return capture
  }
}

// The page pushes edits of the captured editor until a signing request binds the text to a proof.
async function applyCaptureUpdate(tabId: number | undefined, update: Record<string, unknown>): Promise<void> {
  if (typeof tabId !== 'number' || typeof update.operationId !== 'string' || typeof update.text !== 'string') return
  const [stored, job] = await Promise.all([
    chrome.storage.session.get(CAPTURE_KEY),
    readSigningJob(),
  ])
  if (job) return
  const capture = stored[CAPTURE_KEY] as StoredCapture | undefined
  if (!capture || capture.tabId !== tabId || capture.operationId !== update.operationId) return
  if (capture.text === update.text) return
  await chrome.storage.session.set({ [CAPTURE_KEY]: { ...capture, text: update.text } })
}

// Auto mode resolves a whole new target, so this replaces the capture instead of patching its text.
async function applyAutoCapture(tabId: number | undefined, update: Record<string, unknown>): Promise<void> {
  if (typeof tabId !== 'number' || typeof update.text !== 'string' || !update.text.trim()) return
  const [ephemeral, local, job] = await Promise.all([
    chrome.storage.session.get(CAPTURE_KEY),
    chrome.storage.local.get(AUTO_KEY),
    readSigningJob(),
  ])
  if (job) return
  const auto = local[AUTO_KEY] as AutoCaptureState | undefined
  if (!auto?.enabled || auto.tabId !== tabId) return
  const capture = ephemeral[CAPTURE_KEY] as StoredCapture | undefined
  if (capture && capture.operationId === update.operationId && capture.text === update.text) return
  await chrome.storage.session.set({
    [CAPTURE_KEY]: {
      tabId,
      operationId: typeof update.operationId === 'string' ? update.operationId : undefined,
      text: update.text,
      canReplace: update.canReplace === true,
    } satisfies StoredCapture,
  })
}

// The preference is sticky and defaults to on; the armed state above is per tab and per panel.
async function followPreference(): Promise<boolean> {
  const stored = await chrome.storage.local.get(FOLLOW_KEY)
  return stored[FOLLOW_KEY] !== false
}

async function setAutoCapture(enabled: boolean, remember = false): Promise<AutoCaptureState> {
  const stored = await chrome.storage.local.get(AUTO_KEY)
  const previous = stored[AUTO_KEY] as AutoCaptureState | undefined
  if (remember) await chrome.storage.local.set({ [FOLLOW_KEY]: enabled })
  if (!enabled) {
    if (typeof previous?.tabId === 'number') {
      await chrome.tabs.sendMessage(previous.tabId, { type: 'LIBRO_SET_AUTO_CAPTURE', enabled: false })
        .catch(() => undefined)
    }
    const next: AutoCaptureState = { enabled: false, tabId: previous?.tabId ?? -1 }
    await chrome.storage.local.set({ [AUTO_KEY]: next })
    return next
  }

  const tabId = await activeTabId()
  await ensureContentScript(tabId)
  const next: AutoCaptureState = { enabled: true, tabId }
  // Store before arming so the immediate flush the content script sends is not dropped.
  await chrome.storage.local.set({ [AUTO_KEY]: next })
  await chrome.tabs.sendMessage(tabId, { type: 'LIBRO_SET_AUTO_CAPTURE', enabled: true })
  return next
}

async function disarmAutoCapture(tabId: number, reason: AutoCaptureState['reason']): Promise<void> {
  const stored = await chrome.storage.local.get(AUTO_KEY)
  const auto = stored[AUTO_KEY] as AutoCaptureState | undefined
  if (!auto?.enabled || auto.tabId !== tabId) return
  await chrome.storage.local.set({ [AUTO_KEY]: { enabled: false, tabId, reason } satisfies AutoCaptureState })
}

// sidePanel.open() is only allowed inside a user gesture, which a message from the popup no longer
// carries. The popup opens the panel itself and says so here; the context menu still holds a gesture.
async function openSigningPanel(requestedTabId?: number, hintText?: string, alreadyOpen = false): Promise<StoredCapture> {
  const tabId = requestedTabId ?? await activeTabId()
  const opening = alreadyOpen ? Promise.resolve() : chrome.sidePanel.open({ tabId })
  const capture = await captureActiveText(tabId, hintText)
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
  const body = await response.json().catch(() => ({})) as T & {
    message?: string
    code?: string
    retryable?: boolean
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      await chrome.storage.local.remove([TOKEN_KEY, SESSION_KEY])
    }
    throw new MemoriosoApiError(
      body.message || `Memorioso returned HTTP ${response.status}`,
      response.status,
      body.code,
      body.retryable === true
    )
  }
  return body
}

async function hydrateFinalizedJob(job: SigningJob): Promise<SigningJob> {
  if (job.stage !== 'finalized' || !job.publicationId) return job
  const manifest = await apiFetch<unknown>(`/api/publications/${job.publicationId}/libro-manifest`, {}, false)
  return { ...job, tag: formatLibroTextTag(manifest) }
}

async function currentState(): Promise<Record<string, unknown>> {
  const [stored, ephemeral, restoredJob] = await Promise.all([
    chrome.storage.local.get([SESSION_KEY, AUTO_KEY]),
    chrome.storage.session.get(CAPTURE_KEY),
    readSigningJob(),
  ])
  let job = restoredJob
  if (job && typeof stored[SESSION_KEY] === 'object') {
    try {
      const recovery = await apiFetch<{
        stage: 'challenge' | 'prepared' | 'registered' | 'finalized'
        registrationId?: string
        transactionHash?: string
        publicationId?: string
      }>(`/api/extension/signatures/${job.signingId}`)
      const recovered: SigningJob = {
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
      await saveSigningJob(recovered)
      job = recovered
      job = await hydrateFinalizedJob(job)
    } catch {
      // Cached state remains useful when the API is temporarily unavailable.
    }
  }
  return {
    session: stored[SESSION_KEY] || null,
    capture: ephemeral[CAPTURE_KEY] || null,
    job: job || null,
    autoCapture: stored[AUTO_KEY] || null,
    followPages: await followPreference(),
    apiOrigin: API_ORIGIN,
  }
}

async function handleMessage(message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case 'LIBRO_SCAN_ACTIVE_TAB':
      return scanActiveTab()
    case 'LIBRO_GET_AUTO_SCAN': {
      const [preferred, granted] = await Promise.all([autoScanPreference(), hasAutoScanPermission()])
      return { success: true, enabled: preferred && granted, granted }
    }
    case 'LIBRO_SET_AUTO_SCAN': {
      // Permission must already have been requested inside the options page gesture; Chrome
      // rejects a request made from here, so this only reconciles what that answer allows.
      const enabled = await setAutoScan(message.enabled === true)
      // Turning it off should not leave a record of which signed documents were read behind it.
      if (!enabled) await clearLibroVerificationCache()
      return { success: true, enabled }
    }
    case 'LIBRO_START_SIGNING':
      return {
        success: true,
        capture: await openSigningPanel(
          typeof message.tabId === 'number' ? message.tabId : undefined,
          undefined,
          message.panelOpened === true,
        ),
      }
    case 'LIBRO_CAPTURE_ACTIVE_TEXT':
      return { success: true, capture: await captureActiveText() }
    case 'LIBRO_SET_AUTO_CAPTURE':
      return {
        success: true,
        autoCapture: await setAutoCapture(message.enabled === true, message.remember === true),
      }
    case 'LIBRO_GET_SIGNING_STATE':
      return { success: true, ...(await currentState()) }
    case 'LIBRO_HANDLE_LOOKUP':
      if (typeof message.handle !== 'string') throw new Error('A Memorioso handle is required')
      return apiFetch(`/api/auth/handle?handle=${encodeURIComponent(message.handle)}`, {}, false)
    case 'LIBRO_AUTH_CONTEXT':
      return apiFetch('/api/extension/auth/context', {
        method: 'POST',
        body: JSON.stringify({ handle: message.handle, intent: message.intent }),
      }, false)
    case 'LIBRO_AUTH_VERIFY': {
      const response = await apiFetch<{
        token: string
        user: unknown
        author: unknown
        created: boolean
        expiresAt: string
      }>(
        '/api/extension/auth/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            attemptId: message.attemptId,
            idkitResult: message.idkitResult,
            profile: message.profile,
          }),
        },
        false
      )
      await chrome.storage.local.set({
        [TOKEN_KEY]: response.token,
        [SESSION_KEY]: { user: response.user, expiresAt: response.expiresAt },
      })
      return {
        success: true,
        user: response.user,
        author: response.author,
        created: response.created,
        expiresAt: response.expiresAt,
      }
    }
    case 'LIBRO_AUTH_SESSION': {
      const response = await apiFetch<{ user: unknown; expiresAt: string }>('/api/extension/auth/session')
      await chrome.storage.local.set({ [SESSION_KEY]: response })
      return { success: true, ...response }
    }
    case 'LIBRO_AUTH_LOGOUT':
      await apiFetch('/api/extension/auth/session', { method: 'DELETE' }).catch(() => undefined)
      await Promise.all([
        chrome.storage.local.remove([TOKEN_KEY, SESSION_KEY]),
        chrome.storage.session.remove(CAPTURE_KEY),
        clearSigningJob(),
      ])
      return { success: true }
    case 'LIBRO_CREATE_SIGNATURE': {
      const response = await apiFetch<Record<string, unknown>>('/api/extension/signatures', {
        method: 'POST',
        body: JSON.stringify({ text: message.text }),
      })
      const job: SigningJob = {
        version: SIGNING_JOB_VERSION,
        draftId: response.draftId as string,
        signingId: response.signingId as string,
        challengeId: response.challengeId as string,
        normalizedText: response.normalizedText as string,
        author: response.author as SigningJob['author'],
        context: response,
        stage: 'proof',
      }
      await saveSigningJob(job)
      return { success: true, job }
    }
    case 'LIBRO_PREPARE_SIGNATURE': {
      const job = await readSigningJob()
      if (!job) throw new Error('No inline signing request is active')
      const response = await apiFetch<{ registrationId: string }>(`/api/draft/${job.draftId}/publish/prepare`, {
        method: 'PUT',
        body: JSON.stringify({ challengeId: job.challengeId, idkitResult: message.idkitResult }),
      })
      const next = { ...job, stage: 'prepared' as const, registrationId: response.registrationId }
      await saveSigningJob(next)
      return { success: true, job: next }
    }
    case 'LIBRO_RELAY_SIGNATURE': {
      const job = await readSigningJob()
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
      await saveSigningJob(next)
      return { success: true, job: next }
    }
    case 'LIBRO_FINALIZE_SIGNATURE': {
      const job = await readSigningJob()
      if (!job) throw new Error('No inline signing request is active')
      let finalized: SigningJob
      if (job.stage === 'finalized' && job.publicationId) {
        finalized = job
      } else {
        if (!job.registrationId || !job.transactionHash) throw new Error('The Libro registration has not been relayed')
        const finalizePath = `/api/draft/${job.draftId}/publish/finalize`
        const finalizeBody = JSON.stringify({
          registrationId: job.registrationId,
          submissionMethod: 'memorioso_relayer',
          transactionHash: job.transactionHash,
        })
        const response = await retryWithBackoff(
          (signal) => apiFetch<{ publicationId: string }>(finalizePath, {
            method: 'PUT',
            body: finalizeBody,
            signal,
          }),
          { shouldRetry: isRetryableFinalizeFailure }
        )
        finalized = { ...job, stage: 'finalized', publicationId: response.publicationId }
        await saveSigningJob(finalized)
      }
      const next = await hydrateFinalizedJob(finalized)
      return {
        success: true,
        job: next,
        publicationUrl: `${API_ORIGIN}/short/${finalized.publicationId}`,
      }
    }
    case 'LIBRO_INSERT_TAG': {
      const [stored, persistedJob] = await Promise.all([
        chrome.storage.session.get(CAPTURE_KEY),
        readSigningJob(),
      ])
      const capture = stored[CAPTURE_KEY] as StoredCapture | undefined
      const job = persistedJob ? await hydrateFinalizedJob(persistedJob) : undefined
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
      const job = await readSigningJob()
      if (job && job.stage === 'proof') {
        await apiFetch(`/api/extension/signatures/${job.signingId}`, { method: 'DELETE' }).catch(() => undefined)
      }
      await clearSigningJob()
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
  storageReady.then(syncAutoScan).catch(() => undefined)
})

chrome.runtime.onStartup.addListener(() => {
  storageReady.then(syncAutoScan).catch(() => undefined)
})

// Host permission can be revoked from chrome://extensions without the extension being asked, so
// the registered script and the preference are reconciled whenever the grant changes.
chrome.permissions.onRemoved.addListener(() => {
  storageReady.then(async () => {
    await clearLibroVerificationCache()
    await syncAutoScan()
  }).catch(() => undefined)
})

chrome.permissions.onAdded.addListener(() => {
  storageReady.then(async () => {
    await clearLibroVerificationCache()
    await syncAutoScan()
  }).catch(() => undefined)
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[RPC_SETTINGS_KEY]) {
    storageReady.then(clearLibroVerificationCache).catch(() => undefined)
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (typeof tab?.id !== 'number') return
  const hintText = typeof info.selectionText === 'string' ? info.selectionText : undefined
  storageReady.then(() => openSigningPanel(tab.id, hintText)).catch(() => undefined)
})

// Following exists to feed the open panel, so closing the panel must stop the page from reporting.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'libro-side-panel' || !isTrustedExtensionPageSender(port.sender || {})) return
  port.onDisconnect.addListener(() => {
    setAutoCapture(false).catch(() => undefined)
  })
})

// The activeTab grant and the injected listeners both end at navigation, so following ends with them.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return
  const pendingRescan = automaticRescanTimers.get(tabId)
  if (pendingRescan) clearTimeout(pendingRescan)
  automaticRescanTimers.delete(tabId)
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => undefined)
  storageReady.then(() => disarmAutoCapture(tabId, 'navigated')).catch(() => undefined)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  const pendingRescan = automaticRescanTimers.get(tabId)
  if (pendingRescan) clearTimeout(pendingRescan)
  automaticRescanTimers.delete(tabId)
  storageReady.then(() => disarmAutoCapture(tabId, 'closed')).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const typed = message as Record<string, unknown>
  if (isContentNotification(typed.type)) {
    if (!isTrustedContentSender(sender)) return
    const tabId = sender.tab?.id
    storageReady.then(async () => {
      if (typed.type === 'LIBRO_CAPTURE_UPDATE') await applyCaptureUpdate(tabId, typed)
      else if (typed.type === 'LIBRO_AUTO_CAPTURE') await applyAutoCapture(tabId, typed)
      else if (typed.type === 'LIBRO_PAGE_MAY_HAVE_LIBRO') await scanAnnouncedPage(tabId)
      else if (typed.type === 'LIBRO_RESULT_STALE' && typeof tabId === 'number') {
        chrome.action.setBadgeBackgroundColor({ color: '#b45309', tabId }).catch(() => undefined)
        chrome.action.setBadgeText({ text: '?', tabId }).catch(() => undefined)
        await scheduleAutomaticRescan(tabId)
      }
    }).catch(() => undefined)
    return
  }
  if (typeof typed.type === 'string' && typed.type.startsWith('LIBRO_')) {
    if (!isTrustedExtensionPageSender(sender)) {
      sendResponse({ success: false, message: 'This extension request is not allowed from a webpage' })
      return
    }
    storageReady.then(() => handleMessage(typed))
      .then(sendResponse)
      .catch((error) => sendResponse({
        success: false,
        message: error instanceof Error ? error.message : 'The extension request failed',
      }))
    return true
  }
})
