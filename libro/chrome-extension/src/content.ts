import { isIndeterminateStatus, type LibroCandidate, type LibroVerificationResult } from './shared'
import {
  captureCurrentText,
  replaceCapture,
  watchCapture,
  watchPageCaptures,
  type AutoCaptureController,
  type CaptureResponse,
  type CaptureTarget,
  type CaptureWatcher,
} from './capture'

type LibroTextTagV1 = {
  authorHandle: string
  publicationDate: string
  signalHash: string
  manifestUrl: string | null
  bodyText: string
}

// Keep this lightweight parser aligned with @libro/core; the injected IIFE must stay self-contained.
const LIBRO_TEXT_TAG_PATTERN = new RegExp(
  String.raw`(?:^|\n)=== Libro · Signed by a human · @([^\s·]+) · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) · (0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{6}(?:…|\.\.\.)[0-9a-fA-F]{4}))(?: · ([^\s]+))? ===[\t ]*\n([\s\S]*?)\n=== End Libro ===(?=$|\n)`,
  'g'
)

function normalizeReadableText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function parseLibroTextTags(value: string): LibroTextTagV1[] {
  const normalized = value.replace(/\r\n?/g, '\n')
  const tags: LibroTextTagV1[] = []
  LIBRO_TEXT_TAG_PATTERN.lastIndex = 0
  for (const match of normalized.matchAll(LIBRO_TEXT_TAG_PATTERN)) {
    const bodyText = normalizeReadableText(match[5])
    if (!bodyText) continue
    tags.push({
      authorHandle: match[1],
      publicationDate: match[2],
      signalHash: match[3].toLowerCase(),
      manifestUrl: match[4] || null,
      bodyText,
    })
  }
  return tags
}

function libroTextTagHashMatches(declaredHash: string, signalHash: string): boolean {
  const declared = declaredHash.toLowerCase().replace('...', '…')
  const expected = signalHash.toLowerCase()
  if (/^0x[0-9a-f]{64}$/.test(declared)) return declared === expected
  return declared === `${expected.slice(0, 8)}…${expected.slice(-4)}`
}

{
  type LibroContentState = {
    observers: MutationObserver[]
    captures: Map<string, CaptureTarget>
    watcher?: CaptureWatcher
    autoWatcher?: AutoCaptureController
    operationId?: string
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

  function clearDecorations(resetBlockIds = false): void {
    document.querySelectorAll(`[${BADGE_ATTRIBUTE}]`).forEach((node) => node.remove())
    document.querySelectorAll<HTMLElement>(`[${BLOCK_ATTRIBUTE}]`).forEach((node) => {
      node.classList.remove(...STATE_CLASSES)
      if (resetBlockIds) node.removeAttribute(BLOCK_ATTRIBUTE)
    })
    const previous = contentGlobal.__libroVerifierContentState
    previous?.observers.forEach((observer) => observer.disconnect())
    contentGlobal.__libroVerifierContentState = {
      observers: [],
      captures: previous?.captures || new Map(),
      watcher: previous?.watcher,
      autoWatcher: previous?.autoWatcher,
      operationId: previous?.operationId,
    }
  }

  function findManifestNodes(id: string): HTMLScriptElement[] {
    return Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/libro+json"]'))
      .filter((node) => node.id === id)
  }

  function addBlockId(block: HTMLElement, blockId: string): void {
    const ids = new Set((block.getAttribute(BLOCK_ATTRIBUTE) || '').split(/\s+/).filter(Boolean))
    ids.add(blockId)
    block.setAttribute(BLOCK_ATTRIBUTE, Array.from(ids).join(' '))
  }

  function textTagManifest(tag: LibroTextTagV1): {
    manifestId: string | null
    manifestText: string | null
    error?: string
  } {
    const matches = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/libro+json"]'))
      .flatMap((node) => {
        try {
          const parsed = JSON.parse(node.textContent || '') as { registration?: { signal_hash?: unknown } }
          const hash = parsed.registration?.signal_hash
          return typeof hash === 'string' && libroTextTagHashMatches(tag.signalHash, hash)
            ? [{ node, hash }]
            : []
        } catch {
          return []
        }
      })

    if (matches.length > 1) {
      return { manifestId: null, manifestText: null, error: 'More than one inline manifest matches the text tag' }
    }
    if (matches.length === 0) return { manifestId: null, manifestText: null }
    return {
      manifestId: matches[0].node.id || null,
      manifestText: matches[0].node.textContent,
    }
  }

  /**
   * Pre-filter so automatic scanning can run on every page without paying for a full scan on the
   * overwhelming majority that hold nothing. The selector match costs one tree query, and
   * `textContent` reads the DOM without forcing the layout that `innerText` below does.
   *
   * This can only be more permissive than the scan it guards: embeds carry the class, and a text
   * tag always contains the literal "Libro" that `textScanTargets` already keys on.
   */
  function pageMayContainLibro(): boolean {
    if (document.querySelector('.libro-human-signed, script[type="application/libro+json"]')) return true
    return document.documentElement?.textContent?.includes('Libro') === true
  }

  function textScanTargets(): HTMLElement[] {
    const body = document.body
    if (!body) return []
    const targets = new Set<HTMLElement>()
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      if (node.textContent?.includes('Libro')) {
        let element = node.parentElement
        while (element) {
          if (element.closest(`[${BADGE_ATTRIBUTE}]`) || element.closest('.libro-human-signed')) break
          if (!element.matches('script, style, noscript, textarea, input, select, option') &&
            !element.querySelector('.libro-human-signed') &&
            parseLibroTextTags(element.innerText || '').length > 0) {
            targets.add(element)
            break
          }
          if (element === body) break
          element = element.parentElement
        }
      }
      node = walker.nextNode()
    }
    return Array.from(targets)
  }

  function scanTextTags(indexOffset: number): LibroCandidate[] {
    const candidates: LibroCandidate[] = []
    let index = indexOffset
    for (const block of textScanTargets()) {
      for (const tag of parseLibroTextTags(block.innerText || '')) {
        const blockId = `${Date.now()}-${index}-${crypto.randomUUID()}`
        index += 1
        addBlockId(block, blockId)
        const inlineManifest = textTagManifest(tag)
        candidates.push({
          blockId,
          kind: 'text',
          innerHtml: block.innerHTML,
          readableText: tag.bodyText,
          snapshotHtml: block.innerHTML,
          declaredHash: tag.signalHash,
          manifestId: inlineManifest.manifestId,
          manifestText: inlineManifest.manifestText,
          manifestUrl: tag.manifestUrl,
          declaredAuthorHandle: tag.authorHandle,
          declaredPublicationDate: tag.publicationDate,
          ...(inlineManifest.error ? { error: inlineManifest.error } : {}),
        })
      }
    }
    return candidates
  }

  function scan(): LibroCandidate[] {
    clearDecorations(true)
    if (!pageMayContainLibro()) return []
    const embeds = Array.from(document.querySelectorAll<HTMLElement>('.libro-human-signed')).map((block, index): LibroCandidate => {
      const blockId = `${Date.now()}-${index}-${crypto.randomUUID()}`
      addBlockId(block, blockId)
      const manifestId = block.dataset.libroManifest || null
      const declaredHash = block.dataset.libroSignalHash || null

      if (block.dataset.libroClaim !== 'human-signed') {
        return {
          blockId,
          kind: 'embed',
          innerHtml: block.innerHTML,
          snapshotHtml: block.innerHTML,
          declaredHash,
          manifestId,
          manifestText: null,
          error: 'The block does not declare the human-signed Libro claim',
        }
      }

      if (!manifestId) {
        return {
          blockId,
          kind: 'embed',
          innerHtml: block.innerHTML,
          snapshotHtml: block.innerHTML,
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
          kind: 'embed',
          innerHtml: block.innerHTML,
          snapshotHtml: block.innerHTML,
          declaredHash,
          manifestId,
          manifestText: null,
          error: manifests.length === 0 ? 'Referenced manifest was not found' : 'Manifest id is duplicated',
        }
      }

      return {
        blockId,
        kind: 'embed',
        innerHtml: block.innerHTML,
        snapshotHtml: block.innerHTML,
        declaredHash,
        manifestId,
        manifestText: manifests[0].textContent,
      }
    })
    return [...embeds, ...scanTextTags(embeds.length)]
  }

  function stateClass(status: LibroVerificationResult['status']): string {
    if (status === 'verified') return 'libro-extension-verified'
    if (status === 'stale') return 'libro-extension-stale'
    if (isIndeterminateStatus(status)) return 'libro-extension-unknown'
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
      : isIndeterminateStatus(result.status)
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
        label: 'Changed',
        detail: 'The page changed after verification. Reopen the Libro popup to check it again.',
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
    const watches: Array<{
      block: HTMLElement
      manifest: HTMLScriptElement | null
      result: LibroVerificationResult
    }> = []
    for (const result of results) {
      const block = document.querySelector<HTMLElement>(`[${BLOCK_ATTRIBUTE}~="${result.blockId}"]`)
      if (!block) continue
      const snapshot = snapshots.get(result.blockId)
      const manifestId = snapshot?.kind === 'text' ? snapshot.manifestId : block.dataset.libroManifest
      const manifest = manifestId ? findManifestNodes(manifestId)[0] || null : null
      const changedDuringVerification = !snapshot ||
        snapshot.snapshotHtml !== block.innerHTML ||
        (snapshot.kind === 'embed' && snapshot.manifestText !== (manifest?.textContent || null)) ||
        (snapshot.kind === 'embed' && snapshot.manifestId !== (block.dataset.libroManifest || null)) ||
        (snapshot.kind === 'embed' && snapshot.declaredHash !== (block.dataset.libroSignalHash || null))
      const appliedResult: LibroVerificationResult = changedDuringVerification
        ? {
            ...result,
            status: 'stale',
            label: 'Changed',
            detail: 'The page changed while verification was running. Reopen the Libro popup to check it again.',
          }
        : result
      if (changedDuringVerification) staleBlockIds.push(result.blockId)
      block.classList.add(stateClass(appliedResult.status))
      addBadge(block, appliedResult)
      watches.push({ block, manifest, result: appliedResult })
    }
    watches.forEach(({ block, manifest, result }) => markStale(block, manifest, result))
    return staleBlockIds
  }

  // Mirroring edits of the captured editor is part of following, so it lives and dies with it.
  // Without following, the panel holds the snapshot it captured until it captures again.
  function syncElementWatcher(state: LibroContentState): void {
    state.watcher?.stop()
    state.watcher = undefined
    if (!state.autoWatcher || !state.operationId) return
    state.watcher = watchCapture(state.captures, state.operationId, (update) => {
      chrome.runtime.sendMessage({ type: 'LIBRO_CAPTURE_UPDATE', ...update }).catch(() => undefined)
    })
  }

  function adoptCapture(state: LibroContentState, capture: CaptureResponse): void {
    state.operationId = capture.success ? capture.operationId : undefined
    syncElementWatcher(state)
  }

  function setAutoCapture(state: LibroContentState, enabled: boolean): void {
    state.autoWatcher?.stop()
    state.autoWatcher = undefined
    if (enabled) {
      state.autoWatcher = watchPageCaptures(
        state.captures,
        () => state.operationId,
        (capture) => {
          adoptCapture(state, capture)
          chrome.runtime.sendMessage({ type: 'LIBRO_AUTO_CAPTURE', ...capture }).catch(() => undefined)
        }
      )
    }
    // Picks up the capture the panel already holds, or drops it when following is turned off.
    syncElementWatcher(state)
    // Sync to whatever is focused right now instead of waiting for the next page event.
    state.autoWatcher?.flush()
  }

  if (!contentGlobal.__libroVerifierContentState) {
    contentGlobal.__libroVerifierContentState = { observers: [], captures: new Map() }
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const typed = message as {
        type?: string
        results?: LibroVerificationResult[]
        candidates?: LibroCandidate[]
        operationId?: string
        replacement?: string
        hintText?: string
        enabled?: boolean
      }
      if (typed.type === 'LIBRO_SCAN_PAGE') {
        sendResponse({ candidates: scan() })
        return
      }
      if (typed.type === 'LIBRO_APPLY_RESULTS' && Array.isArray(typed.results) && Array.isArray(typed.candidates)) {
        sendResponse({ success: true, staleBlockIds: applyResults(typed.results, typed.candidates) })
        return
      }
      if (typed.type === 'LIBRO_CAPTURE_TEXT') {
        const state = contentGlobal.__libroVerifierContentState!
        const capture = captureCurrentText(
          state.captures,
          document,
          window,
          { hintText: typeof typed.hintText === 'string' ? typed.hintText : undefined }
        )
        // Mirror later edits of the same editor into the side panel.
        adoptCapture(state, capture)
        sendResponse(capture)
        return
      }
      if (typed.type === 'LIBRO_SET_AUTO_CAPTURE') {
        const state = contentGlobal.__libroVerifierContentState!
        setAutoCapture(state, typed.enabled === true)
        sendResponse({ success: true })
        return
      }
      if (typed.type === 'LIBRO_REPLACE_CAPTURE' && typeof typed.operationId === 'string' && typeof typed.replacement === 'string') {
        const state = contentGlobal.__libroVerifierContentState!
        state.watcher?.stop()
        state.watcher = undefined
        // Auto mode stays armed; the service worker suppresses pushes until the job is cleared.
        state.operationId = undefined
        sendResponse(replaceCapture(state.captures, typed.operationId, typed.replacement))
      }
    })

    // Registered injection has no caller waiting on a scan, so a page that might hold something
    // announces itself and the service worker decides whether automatic verification is on. Sent
    // only on first initialization, so re-injecting over an existing content script stays silent.
    if (pageMayContainLibro()) {
      chrome.runtime.sendMessage({ type: 'LIBRO_PAGE_MAY_HAVE_LIBRO' }).catch(() => undefined)
    }
  }
}
