import { verifyCandidate } from './verifier'
import type { LibroCandidate, LibroVerificationResult, ScanResponse } from './shared'

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
    const candidates = Array.isArray(scanResult?.candidates) ? scanResult.candidates : []
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
