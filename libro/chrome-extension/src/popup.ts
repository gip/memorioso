import type { LibroVerificationResult, LibroVerificationSource, ScanResponse } from './shared'

const summary = document.querySelector<HTMLElement>('#summary')
const resultsNode = document.querySelector<HTMLElement>('#results')
const rescan = document.querySelector<HTMLButtonElement>('#rescan')
const sign = document.querySelector<HTMLButtonElement>('#sign')
const endpoints = document.querySelector<HTMLButtonElement>('#endpoints')

endpoints?.addEventListener('click', () => chrome.runtime.openOptionsPage())

// sidePanel.open() only runs inside the user gesture that triggered it, and neither the hop to
// the service worker nor an await inside the handler preserves one. So the popup opens the panel
// itself, and the tab id is resolved up front because the click handler cannot await for it.
let signingTabId: number | null = null
if (sign) sign.disabled = true
chrome.tabs.query({ active: true, currentWindow: true })
  .then(([tab]) => {
    if (typeof tab?.id !== 'number') return
    signingTabId = tab.id
    if (sign) sign.disabled = false
  })
  .catch(() => undefined)

function shortHash(value?: string): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : ''
}

function formatPublicationDate(value?: string): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function renderResult(item: LibroVerificationResult): HTMLElement {
  const card = document.createElement('article')
  card.className = `result ${item.status}`

  const heading = document.createElement('div')
  heading.className = 'result-heading'
  const label = document.createElement('strong')
  label.textContent = item.label
  const hash = document.createElement('code')
  hash.textContent = shortHash(item.signalHash)
  heading.append(label, hash)

  const metadata = document.createElement('div')
  metadata.className = 'metadata'
  const date = formatPublicationDate(item.publicationDate)
  metadata.textContent = [item.authorHandle ? `@${item.authorHandle}` : null, date].filter(Boolean).join(' · ')

  const detail = document.createElement('p')
  detail.textContent = item.detail
  card.append(heading)
  if (metadata.textContent) card.append(metadata)
  card.append(detail)
  if (item.sources?.length) card.append(renderSources(item.sources))
  return card
}

const SOURCE_LABELS: Record<LibroVerificationSource['status'], string> = {
  verified: 'confirmed',
  not_registered: 'not registered',
  mismatch: 'contradicted',
  unconfirmed: 'no transaction record',
  unavailable: 'unreachable',
}

function renderSources(sources: LibroVerificationSource[]): HTMLElement {
  const list = document.createElement('ul')
  list.className = 'sources'
  sources.forEach((source) => {
    const item = document.createElement('li')
    item.className = `source ${source.status}`
    item.title = source.detail
    const host = document.createElement('span')
    host.textContent = source.label
    const verdict = document.createElement('em')
    verdict.textContent = SOURCE_LABELS[source.status]
    item.append(host, verdict)
    list.append(item)
  })
  return list
}

function render(response: ScanResponse): void {
  if (!summary || !resultsNode) return
  resultsNode.replaceChildren()
  if (!response.success) {
    summary.textContent = response.message || 'This page could not be scanned.'
    summary.className = 'summary error'
    return
  }

  const verified = response.results.filter((item) => item.status === 'verified').length
  summary.textContent = response.results.length === 0
    ? 'No Libro human-signed declarations found.'
    : `${verified} of ${response.results.length} Libro declaration${response.results.length === 1 ? '' : 's'} verified.`
  summary.className = `summary ${verified > 0 ? 'success' : ''}`
  response.results.forEach((item) => resultsNode.append(renderResult(item)))
}

async function scan(): Promise<void> {
  if (summary && resultsNode) {
    summary.textContent = 'Scanning this page…'
    summary.className = 'summary'
    resultsNode.replaceChildren()
  }
  rescan?.setAttribute('disabled', 'true')
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LIBRO_SCAN_ACTIVE_TAB' }) as ScanResponse
    render(response)
  } catch (error) {
    render({
      success: false,
      results: [],
      message: error instanceof Error ? error.message : 'The extension service is unavailable.',
    })
  } finally {
    rescan?.removeAttribute('disabled')
  }
}

rescan?.addEventListener('click', scan)
sign?.addEventListener('click', async () => {
  const tabId = signingTabId
  if (tabId === null) return
  // First statement in the handler: anything awaited before this consumes the gesture.
  const opening = chrome.sidePanel.open({ tabId })
  sign.disabled = true
  try {
    await opening
    const response = await chrome.runtime.sendMessage({
      type: 'LIBRO_START_SIGNING',
      tabId,
      panelOpened: true,
    }) as { success?: boolean; message?: string }
    if (!response?.success) throw new Error(response?.message || 'Could not open Libro signing')
    window.close()
  } catch (error) {
    render({
      success: false,
      results: [],
      message: error instanceof Error ? error.message : 'Could not open Libro signing',
    })
    sign.disabled = false
  }
})
scan()
