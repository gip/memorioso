import type { LibroCandidate, LibroVerificationResult } from './shared'

{
  type LibroContentState = {
    observers: MutationObserver[]
  }

  const contentGlobal = globalThis as typeof globalThis & {
    __libroVerifierContentState?: LibroContentState
  }

  const STYLE_ID = 'libro-extension-verifier-style'
  const BADGE_ATTRIBUTE = 'data-libro-extension-badge'
  const BLOCK_ATTRIBUTE = 'data-libro-extension-id'
  const STATE_CLASSES = [
    'libro-extension-verified',
    'libro-extension-warning',
    'libro-extension-unknown',
    'libro-extension-stale',
  ]

  function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      .libro-extension-verified { outline: 2px solid #16a34a !important; outline-offset: 4px !important; }
      .libro-extension-warning { outline: 2px solid #dc2626 !important; outline-offset: 4px !important; }
      .libro-extension-unknown, .libro-extension-stale { outline: 2px solid #d97706 !important; outline-offset: 4px !important; }
    `
    document.documentElement.append(style)
  }

  function clearDecorations(): void {
    document.querySelectorAll(`[${BADGE_ATTRIBUTE}]`).forEach((node) => node.remove())
    document.querySelectorAll<HTMLElement>('.libro-human-authored').forEach((node) => {
      node.classList.remove(...STATE_CLASSES)
    })
    contentGlobal.__libroVerifierContentState?.observers.forEach((observer) => observer.disconnect())
    contentGlobal.__libroVerifierContentState = { observers: [] }
  }

  function findManifestNodes(id: string): HTMLScriptElement[] {
    return Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/libro+json"]'))
      .filter((node) => node.id === id)
  }

  function scan(): LibroCandidate[] {
    clearDecorations()
    return Array.from(document.querySelectorAll<HTMLElement>('.libro-human-authored')).map((block, index) => {
      const blockId = `${Date.now()}-${index}-${crypto.randomUUID()}`
      block.setAttribute(BLOCK_ATTRIBUTE, blockId)
      const manifestId = block.dataset.libroManifest || null
      const declaredHash = block.dataset.libroSignalHash || null

      if (block.dataset.libroClaim !== 'human-authored') {
        return {
          blockId,
          innerHtml: block.innerHTML,
          declaredHash,
          manifestId,
          manifestText: null,
          error: 'The block does not declare the human-authored Libro claim',
        }
      }

      if (!manifestId) {
        return {
          blockId,
          innerHtml: block.innerHTML,
          declaredHash,
          manifestId: null,
          manifestText: null,
          error: 'Manifest reference is missing',
        }
      }

      const manifests = findManifestNodes(manifestId)
      if (manifests.length !== 1) {
        return {
          blockId,
          innerHtml: block.innerHTML,
          declaredHash,
          manifestId,
          manifestText: null,
          error: manifests.length === 0 ? 'Referenced manifest was not found' : 'Manifest id is duplicated',
        }
      }

      return {
        blockId,
        innerHtml: block.innerHTML,
        declaredHash,
        manifestId,
        manifestText: manifests[0].textContent,
      }
    })
  }

  function stateClass(status: LibroVerificationResult['status']): string {
    if (status === 'verified') return 'libro-extension-verified'
    if (status === 'network_unavailable') return 'libro-extension-unknown'
    if (status === 'stale') return 'libro-extension-stale'
    return 'libro-extension-warning'
  }

  function addBadge(block: HTMLElement, result: LibroVerificationResult): HTMLElement {
    const host = document.createElement('span')
    host.setAttribute(BADGE_ATTRIBUTE, result.blockId)
    host.style.display = 'inline-block'
    host.style.margin = '8px 0'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = `
      span { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px;
        font: 600 12px/1.2 system-ui, sans-serif; color: white; background: #52525b; }
      .verified { background: #15803d; } .warning { background: #b91c1c; } .unknown { background: #b45309; }
    `
    const badge = document.createElement('span')
    badge.className = result.status === 'verified'
      ? 'verified'
      : result.status === 'network_unavailable' || result.status === 'stale'
        ? 'unknown'
        : 'warning'
    badge.textContent = `Libro · ${result.label}`
    badge.title = result.detail
    shadow.append(style, badge)
    block.insertAdjacentElement('afterend', host)
    return host
  }

  function markStale(block: HTMLElement, manifest: HTMLScriptElement | null, result: LibroVerificationResult): void {
    const observer = new MutationObserver(() => {
      observer.disconnect()
      block.classList.remove(...STATE_CLASSES)
      block.classList.add('libro-extension-stale')
      document.querySelector(`[${BADGE_ATTRIBUTE}="${result.blockId}"]`)?.remove()
      addBadge(block, {
        ...result,
        status: 'stale',
        label: 'Changed — rescan',
        detail: 'The page changed after verification',
      })
      chrome.runtime.sendMessage({ type: 'LIBRO_RESULT_STALE' }).catch(() => undefined)
    })
    observer.observe(block, { attributes: true, characterData: true, childList: true, subtree: true })
    if (manifest) observer.observe(manifest, { attributes: true, characterData: true, childList: true, subtree: true })
    contentGlobal.__libroVerifierContentState?.observers.push(observer)
  }

  function applyResults(results: LibroVerificationResult[], candidates: LibroCandidate[]): string[] {
    ensureStyles()
    clearDecorations()
    const snapshots = new Map(candidates.map((candidate) => [candidate.blockId, candidate]))
    const staleBlockIds: string[] = []
    for (const result of results) {
      const block = document.querySelector<HTMLElement>(`[${BLOCK_ATTRIBUTE}="${result.blockId}"]`)
      if (!block) continue
      const manifestId = block.dataset.libroManifest
      const manifest = manifestId ? findManifestNodes(manifestId)[0] || null : null
      const snapshot = snapshots.get(result.blockId)
      const changedDuringVerification = !snapshot ||
        snapshot.innerHtml !== block.innerHTML ||
        snapshot.manifestText !== (manifest?.textContent || null) ||
        snapshot.manifestId !== (block.dataset.libroManifest || null) ||
        snapshot.declaredHash !== (block.dataset.libroSignalHash || null)
      const appliedResult: LibroVerificationResult = changedDuringVerification
        ? {
            ...result,
            status: 'stale',
            label: 'Changed — rescan',
            detail: 'The page changed while verification was running',
          }
        : result
      if (changedDuringVerification) staleBlockIds.push(result.blockId)
      block.classList.add(stateClass(appliedResult.status))
      addBadge(block, appliedResult)
      markStale(block, manifest, appliedResult)
    }
    return staleBlockIds
  }

  if (!contentGlobal.__libroVerifierContentState) {
    contentGlobal.__libroVerifierContentState = { observers: [] }
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const typed = message as { type?: string; results?: LibroVerificationResult[]; candidates?: LibroCandidate[] }
      if (typed.type === 'LIBRO_SCAN_PAGE') {
        sendResponse({ candidates: scan() })
        return
      }
      if (typed.type === 'LIBRO_APPLY_RESULTS' && Array.isArray(typed.results) && Array.isArray(typed.candidates)) {
        sendResponse({ success: true, staleBlockIds: applyResults(typed.results, typed.candidates) })
      }
    })
  }
}
