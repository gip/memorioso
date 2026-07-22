import { verifyCandidate } from './verifier'
import type { LibroCandidate, LibroVerificationResult, ScanResponse } from './shared'

const MAX_MANIFEST_BYTES = 1_000_000

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
    if (!response.ok) {
      return { ...candidate, error: `The text tag manifest returned HTTP ${response.status}` }
    }
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_MANIFEST_BYTES) {
      return { ...candidate, error: 'The text tag manifest is too large' }
    }
    const manifestText = await response.text()
    if (manifestText.length > MAX_MANIFEST_BYTES) {
      return { ...candidate, error: 'The text tag manifest is too large' }
    }
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

async function scanActiveTab(): Promise<ScanResponse> {
  try {
    const tabId = await activeTabId()
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const typed = message as { type?: string }
  if (typed.type === 'LIBRO_SCAN_ACTIVE_TAB') {
    scanActiveTab().then(sendResponse)
    return true
  }
  if (typed.type === 'LIBRO_RESULT_STALE') {
    chrome.action.setBadgeBackgroundColor({ color: '#b45309' }).catch(() => undefined)
    chrome.action.setBadgeText({ text: '?' }).catch(() => undefined)
  }
})
