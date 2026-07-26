import type { LibroCandidate, LibroVerificationResult } from './shared'
import { captureCurrentText, replaceCapture, type CaptureTarget } from './capture'

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
    contentGlobal.__libroVerifierContentState?.observers.forEach((observer) => observer.disconnect())
    contentGlobal.__libroVerifierContentState = {
      observers: [],
      captures: contentGlobal.__libroVerifierContentState?.captures || new Map(),
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
    if (status === 'network_unavailable' || status === 'manifest_missing') return 'libro-extension-unknown'
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
      : result.status === 'network_unavailable' || result.status === 'manifest_missing' || result.status === 'stale'
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
            label: 'Changed — rescan',
            detail: 'The page changed while verification was running',
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
        sendResponse(captureCurrentText(
          contentGlobal.__libroVerifierContentState!.captures,
          document,
          window,
          { hintText: typeof typed.hintText === 'string' ? typed.hintText : undefined }
        ))
        return
      }
      if (typed.type === 'LIBRO_REPLACE_CAPTURE' && typeof typed.operationId === 'string' && typeof typed.replacement === 'string') {
        sendResponse(replaceCapture(
          contentGlobal.__libroVerifierContentState!.captures,
          typed.operationId,
          typed.replacement
        ))
      }
    })
  }
}
