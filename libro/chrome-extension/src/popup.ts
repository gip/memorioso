import type { LibroVerificationResult, ScanResponse } from './shared'

const summary = document.querySelector<HTMLElement>('#summary')
const resultsNode = document.querySelector<HTMLElement>('#results')
const rescan = document.querySelector<HTMLButtonElement>('#rescan')
const sign = document.querySelector<HTMLButtonElement>('#sign')

function shortHash(value?: string): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : ''
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
  const date = item.publicationDate?.slice(0, 10)
  metadata.textContent = [item.authorHandle ? `@${item.authorHandle}` : null, date].filter(Boolean).join(' · ')

  const detail = document.createElement('p')
  detail.textContent = item.detail
  card.append(heading)
  if (metadata.textContent) card.append(metadata)
  card.append(detail)
  return card
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
    ? 'No Libro human-authored declarations found.'
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
  sign.disabled = true
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LIBRO_START_SIGNING' }) as { success?: boolean; message?: string }
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
