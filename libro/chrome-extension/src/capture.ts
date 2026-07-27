// 'whole' follows every later edit of the field; 'selection' keeps tracking the captured region.
export type CaptureScope = 'whole' | 'selection'

export type CaptureTarget =
  | {
      kind: 'textarea'
      element: HTMLTextAreaElement | HTMLInputElement
      scope: CaptureScope
      start: number
      end: number
      originalValue: string
      text: string
    }
  | {
      kind: 'contenteditable'
      element: HTMLElement
      scope: CaptureScope
      range: Range
      text: string
    }
  | { kind: 'selection'; text: string }

export type CaptureResponse = {
  success: boolean
  operationId?: string
  text?: string
  canReplace?: boolean
  message?: string
}

export type CaptureOptions = {
  // Chrome resolves the context-menu selection itself, so it survives shadow roots and the focus
  // change that opening the side panel causes. It is a hint, not a source of truth.
  hintText?: string
  // 'auto' runs on every page event, so it stays on the cheap paths and skips the recovery sweeps
  // that only matter when the panel stole focus from the page.
  mode?: 'manual' | 'auto'
}

type BrowserWindow = Window & typeof globalThis

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email'])

function normalizeHint(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function isTextField(node: unknown, view: BrowserWindow): node is HTMLTextAreaElement | HTMLInputElement {
  if (node instanceof view.HTMLTextAreaElement) return true
  return node instanceof view.HTMLInputElement && TEXT_INPUT_TYPES.has(node.type)
}

// Chrome reports the shadow host as the document's active element, so descend into open roots.
function deepActiveElement(documentRef: Document): Element | null {
  let active = documentRef.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

function collectShadowRoots(root: Document | ShadowRoot, collected: ShadowRoot[] = []): ShadowRoot[] {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const shadow = (element as HTMLElement).shadowRoot
    if (!shadow) continue
    collected.push(shadow)
    collectShadowRoots(shadow, collected)
  }
  return collected
}

function editableAncestor(node: Node | null, view: BrowserWindow): HTMLElement | null {
  let current: Node | null = node instanceof view.HTMLElement ? node : node?.parentNode || null
  while (current) {
    if (current instanceof view.HTMLElement) {
      const declared = current.getAttribute('contenteditable')
      if (declared !== null && declared !== 'false') return current
    }
    // ShadowRoot.parentNode is null, so step through the host to keep climbing.
    current = current.parentNode || (current instanceof view.ShadowRoot ? current.host : null)
  }
  return null
}

function staticRangeToRange(candidate: StaticRange | Range, documentRef: Document): Range | null {
  if (candidate instanceof Range) return candidate.cloneRange()
  try {
    const range = documentRef.createRange()
    range.setStart(candidate.startContainer, candidate.startOffset)
    range.setEnd(candidate.endContainer, candidate.endOffset)
    return range
  } catch {
    return null
  }
}

// The plain document selection, without the shadow-root walk that the full reader pays for.
function lightSelectionRanges(windowRef: BrowserWindow): Range[] {
  const selection = windowRef.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return []
  const range = selection.getRangeAt(0).cloneRange()
  return range.toString().length > 0 ? [range] : []
}

// A selection inside a shadow root is not readable through document.getSelection() alone.
function selectionRanges(documentRef: Document, windowRef: BrowserWindow): Range[] {
  const ranges: Range[] = []
  const shadowRoots = collectShadowRoots(documentRef)
  const selection = windowRef.getSelection() as (Selection & {
    getComposedRanges?: (...args: unknown[]) => StaticRange[]
  }) | null

  if (selection && typeof selection.getComposedRanges === 'function' && shadowRoots.length > 0) {
    for (const args of [[{ shadowRoots }], shadowRoots]) {
      try {
        const composed = selection.getComposedRanges(...args)
        for (const staticRange of composed || []) {
          const range = staticRangeToRange(staticRange, documentRef)
          if (range && !range.collapsed) ranges.push(range)
        }
        if (ranges.length > 0) break
      } catch {
        // Try the other call shape, then fall through to the legacy per-root selection.
      }
    }
  }

  for (const shadowRoot of shadowRoots) {
    const shadowSelection = (shadowRoot as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
    if (!shadowSelection || shadowSelection.rangeCount === 0 || shadowSelection.isCollapsed) continue
    ranges.push(shadowSelection.getRangeAt(0).cloneRange())
  }

  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    ranges.push(selection.getRangeAt(0).cloneRange())
  }

  return ranges.filter((range) => range.toString().length > 0)
}

function fieldTargets(documentRef: Document, windowRef: BrowserWindow): Array<HTMLTextAreaElement | HTMLInputElement> {
  const roots: Array<Document | ShadowRoot> = [documentRef, ...collectShadowRoots(documentRef)]
  return roots
    .flatMap((root) => Array.from(root.querySelectorAll('textarea, input')))
    .filter((element): element is HTMLTextAreaElement | HTMLInputElement => isTextField(element, windowRef))
}

function editableTargets(documentRef: Document): HTMLElement[] {
  const roots: Array<Document | ShadowRoot> = [documentRef, ...collectShadowRoots(documentRef)]
  return roots.flatMap((root) => Array.from(
    root.querySelectorAll<HTMLElement>('[contenteditable]:not([contenteditable="false"])')
  ))
}

function scopeFor(text: string, whole: string): CaptureScope {
  return normalizeHint(text) === normalizeHint(whole) ? 'whole' : 'selection'
}

function readableText(element: HTMLElement): string {
  return element.innerText || element.textContent || ''
}

function fieldTarget(element: HTMLTextAreaElement | HTMLInputElement): CaptureTarget | null {
  const start = element.selectionStart ?? 0
  const selectedEnd = element.selectionEnd ?? start
  // A blurred field keeps its selection offsets, which is how a capture survives the focus change.
  const end = selectedEnd > start ? selectedEnd : element.value.length
  const effectiveStart = selectedEnd > start ? start : 0
  const text = element.value.slice(effectiveStart, end)
  if (!text.trim()) return null
  return {
    kind: 'textarea',
    element,
    scope: scopeFor(text, element.value),
    start: effectiveStart,
    end,
    originalValue: element.value,
    text,
  }
}

function rangeTarget(range: Range, windowRef: BrowserWindow): CaptureTarget {
  const text = range.toString()
  const editable = editableAncestor(range.commonAncestorContainer, windowRef)
  if (editable && editable.contains(range.startContainer) && editable.contains(range.endContainer)) {
    return { kind: 'contenteditable', element: editable, scope: scopeFor(text, readableText(editable)), range, text }
  }
  return { kind: 'selection', text }
}

function wholeEditableTarget(element: HTMLElement, documentRef: Document): CaptureTarget | null {
  const text = readableText(element)
  if (!text.trim()) return null
  const range = documentRef.createRange()
  range.selectNodeContents(element)
  return { kind: 'contenteditable', element, scope: 'whole', range, text }
}

function rangeForText(host: HTMLElement, needle: string, documentRef: Document): Range | null {
  const walker = documentRef.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  const offsets: number[] = []
  let combined = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    offsets.push(combined.length)
    nodes.push(node as Text)
    combined += (node as Text).data
  }
  const index = combined.indexOf(needle)
  if (index < 0) return null

  const locate = (position: number): { node: Text; offset: number } | null => {
    for (let cursor = nodes.length - 1; cursor >= 0; cursor -= 1) {
      if (offsets[cursor] <= position) return { node: nodes[cursor], offset: position - offsets[cursor] }
    }
    return null
  }
  const start = locate(index)
  const end = locate(index + needle.length)
  if (!start || !end) return null

  const range = documentRef.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  return range
}

// Resolve the hint against the page so the captured text stays replaceable in place.
function hintTargets(hint: string, documentRef: Document, windowRef: BrowserWindow): CaptureTarget[] {
  const normalized = normalizeHint(hint)
  const targets: CaptureTarget[] = []

  for (const element of fieldTargets(documentRef, windowRef)) {
    const value = element.value
    if (!value) continue
    const index = value.indexOf(hint)
    if (index >= 0) {
      targets.push({
        kind: 'textarea',
        element,
        scope: scopeFor(hint, value),
        start: index,
        end: index + hint.length,
        originalValue: value,
        text: hint,
      })
      continue
    }
    if (normalizeHint(value) === normalized) {
      targets.push({
        kind: 'textarea',
        element,
        scope: 'whole',
        start: 0,
        end: value.length,
        originalValue: value,
        text: value,
      })
    }
  }

  for (const element of editableTargets(documentRef)) {
    const readable = readableText(element)
    if (!readable) continue
    const range = rangeForText(element, hint, documentRef)
    if (range) {
      const text = range.toString()
      targets.push({ kind: 'contenteditable', element, scope: scopeFor(text, readable), range, text })
      continue
    }
    if (normalizeHint(readable) === normalized) {
      const whole = wholeEditableTarget(element, documentRef)
      if (whole) targets.push(whole)
    }
  }

  return targets
}

function rememberCapture(captures: Map<string, CaptureTarget>, target: CaptureTarget): CaptureResponse {
  const operationId = crypto.randomUUID()
  captures.set(operationId, target)
  return {
    success: true,
    operationId,
    text: target.text,
    canReplace: target.kind !== 'selection',
  }
}

export function resolveCaptureTarget(
  documentRef: Document = document,
  windowRef: BrowserWindow = window,
  options: CaptureOptions = {}
): CaptureTarget | null {
  const auto = options.mode === 'auto'
  const hint = options.hintText || ''
  const normalizedHint = normalizeHint(hint)
  const candidates: CaptureTarget[] = []
  const add = (target: CaptureTarget | null): void => {
    if (target && target.text.trim()) candidates.push(target)
  }

  const active = deepActiveElement(documentRef)
  if (isTextField(active, windowRef)) add(fieldTarget(active))
  const ranges = auto ? lightSelectionRanges(windowRef) : selectionRanges(documentRef, windowRef)
  for (const range of ranges) add(rangeTarget(range, windowRef))
  if (active instanceof windowRef.HTMLElement && active.isContentEditable) {
    add(wholeEditableTarget(active, documentRef))
  }

  // The page still has focus while auto mode runs, so the hint and blurred-field recovery sweeps
  // cannot contribute anything the cheap reads missed.
  if (auto) {
    if (candidates.length > 0) return candidates[0]
    for (const range of selectionRanges(documentRef, windowRef)) add(rangeTarget(range, windowRef))
    return candidates[0] || null
  }

  if (normalizedHint) hintTargets(hint, documentRef, windowRef).forEach(add)
  // A field that lost focus to the side panel still reports the offsets the user selected.
  for (const element of fieldTargets(documentRef, windowRef)) {
    if (element === active) continue
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? start
    if (end > start) add(fieldTarget(element))
  }

  if (normalizedHint) {
    const matching = candidates.find((target) => {
      const text = normalizeHint(target.text)
      return text === normalizedHint || text.includes(normalizedHint) || normalizedHint.includes(text)
    })
    // The hint alone still beats an empty panel, even when nothing on the page can be replaced.
    return matching || { kind: 'selection', text: hint }
  }

  return candidates[0] || null
}

export function captureCurrentText(
  captures: Map<string, CaptureTarget>,
  documentRef: Document = document,
  windowRef: BrowserWindow = window,
  options: CaptureOptions = {}
): CaptureResponse {
  const target = resolveCaptureTarget(documentRef, windowRef, options)
  if (!target) {
    return {
      success: false,
      message: 'Select text or focus a textarea or contenteditable editor, or enter text manually.',
    }
  }
  return rememberCapture(captures, target)
}

// Follow the captured region through later edits without re-reading the whole page.
function adjustRegion(
  previous: string,
  next: string,
  start: number,
  end: number
): { start: number; end: number } {
  const shared = Math.min(previous.length, next.length)
  let prefix = 0
  while (prefix < shared && previous[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (suffix < shared - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1

  const removedEnd = previous.length - suffix
  const inserted = next.length - suffix - prefix
  const delta = next.length - previous.length
  const clamp = (value: number): number => Math.min(Math.max(value, 0), next.length)

  if (removedEnd <= start) return { start: clamp(start + delta), end: clamp(end + delta) }
  if (prefix >= end) return { start: clamp(start), end: clamp(end) }
  return { start: clamp(Math.min(start, prefix)), end: clamp(Math.max(prefix + inserted, end + delta)) }
}

// Re-read the captured target after the page changed. Returns null when nothing moved.
export function resyncCapture(
  captures: Map<string, CaptureTarget>,
  operationId: string,
  documentRef: Document = document
): CaptureResponse | null {
  const target = captures.get(operationId)
  if (!target || target.kind === 'selection' || !target.element.isConnected) return null

  if (target.kind === 'textarea') {
    const value = target.element.value
    if (value === target.originalValue) return null
    const region = target.scope === 'whole'
      ? { start: 0, end: value.length }
      : adjustRegion(target.originalValue, value, target.start, target.end)
    target.start = region.start
    target.end = region.end
    target.originalValue = value
    target.text = value.slice(region.start, region.end)
  } else {
    if (target.scope === 'whole') {
      const range = documentRef.createRange()
      range.selectNodeContents(target.element)
      target.range = range
    }
    // A live Range already follows edits inside a captured selection.
    const text = target.scope === 'whole' ? readableText(target.element) : target.range.toString()
    if (text === target.text) return null
    target.text = text
  }

  return { success: true, operationId, text: target.text, canReplace: true }
}

const SYNC_DELAY_MS = 250

export type CaptureWatcher = { stop: () => void }

export function watchCapture(
  captures: Map<string, CaptureTarget>,
  operationId: string,
  onUpdate: (update: CaptureResponse) => void,
  documentRef: Document = document,
  windowRef: BrowserWindow = window
): CaptureWatcher {
  const target = captures.get(operationId)
  if (!target || target.kind === 'selection') return { stop: () => undefined }

  const element = target.element
  let timer = 0
  const flush = (): void => {
    timer = 0
    const update = resyncCapture(captures, operationId, documentRef)
    if (update) onUpdate(update)
  }
  const schedule = (): void => {
    windowRef.clearTimeout(timer)
    timer = windowRef.setTimeout(flush, SYNC_DELAY_MS)
  }

  element.addEventListener('input', schedule)
  return {
    stop: () => {
      windowRef.clearTimeout(timer)
      element.removeEventListener('input', schedule)
    },
  }
}

export type AutoCaptureController = { stop: () => void; flush: () => void }

const AUTO_CAPTURE_EVENTS = ['focusin', 'selectionchange', 'keyup', 'mouseup'] as const

// Decide whether a freshly resolved target replaces the one the panel already holds. Edits inside
// the current target are left to watchCapture, which keeps a selection anchored to its region.
export function supersedesCapture(next: CaptureTarget, current: CaptureTarget | undefined): boolean {
  if (!current) return true
  if (current.kind === 'selection' || next.kind === 'selection') return next.text !== current.text
  if (next.element !== current.element) return true
  // Typing collapses the selection, so the whole field resolves again; that is an edit, not a move.
  if (next.scope === 'whole') return false
  return next.text !== current.text
}

// Follow the user around the page: a different editor or a new selection replaces the capture.
export function watchPageCaptures(
  captures: Map<string, CaptureTarget>,
  currentOperationId: () => string | undefined,
  onCapture: (capture: CaptureResponse) => void,
  documentRef: Document = document,
  windowRef: BrowserWindow = window
): AutoCaptureController {
  let timer = 0

  const flush = (): void => {
    windowRef.clearTimeout(timer)
    timer = 0
    const target = resolveCaptureTarget(documentRef, windowRef, { mode: 'auto' })
    if (!target || !target.text.trim()) return
    const previousId = currentOperationId()
    const previous = previousId ? captures.get(previousId) : undefined
    if (!supersedesCapture(target, previous)) return
    if (previousId) captures.delete(previousId)
    onCapture(rememberCapture(captures, target))
  }

  const schedule = (): void => {
    windowRef.clearTimeout(timer)
    timer = windowRef.setTimeout(flush, SYNC_DELAY_MS)
  }

  // Capture phase so keyboard and pointer selections inside open shadow roots are still observed.
  for (const name of AUTO_CAPTURE_EVENTS) documentRef.addEventListener(name, schedule, true)

  return {
    flush,
    stop: () => {
      windowRef.clearTimeout(timer)
      for (const name of AUTO_CAPTURE_EVENTS) documentRef.removeEventListener(name, schedule, true)
    },
  }
}

export function replaceCapture(
  captures: Map<string, CaptureTarget>,
  operationId: string,
  replacement: string,
  documentRef: Document = document,
  windowRef: BrowserWindow = window
): { success: boolean; message?: string } {
  const target = captures.get(operationId)
  if (!target) return { success: false, message: 'The captured editor is no longer available' }
  captures.delete(operationId)

  if (target.kind === 'selection') {
    return { success: false, message: 'The text was selected outside an editable field' }
  }
  if (!target.element.isConnected) {
    return { success: false, message: 'The editor disappeared before signing completed' }
  }

  if (target.kind === 'textarea') {
    if (target.element.value !== target.originalValue ||
        target.element.value.slice(target.start, target.end) !== target.text) {
      return { success: false, message: 'The editor changed before signing completed' }
    }
    target.element.focus()
    target.element.setRangeText(replacement, target.start, target.end, 'end')
    target.element.dispatchEvent(new windowRef.InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: replacement,
    }))
    return { success: true }
  }

  // Rich editors rewrite their markup constantly, so verify the range itself rather than the HTML.
  if (target.range.toString() !== target.text ||
      !target.element.contains(target.range.startContainer) ||
      !target.element.contains(target.range.endContainer)) {
    return { success: false, message: 'The editor changed before signing completed' }
  }
  target.element.focus()
  const selection = windowRef.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(target.range)
  let inserted = false
  try {
    inserted = documentRef.execCommand('insertText', false, replacement)
  } catch {
    inserted = false
  }
  if (!inserted) {
    target.range.deleteContents()
    const text = documentRef.createTextNode(replacement)
    target.range.insertNode(text)
    target.range.setStartAfter(text)
    target.range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(target.range)
  }
  target.element.dispatchEvent(new windowRef.InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: replacement,
  }))
  return { success: true }
}
