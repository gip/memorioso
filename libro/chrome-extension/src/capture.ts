export type CaptureTarget =
  | {
      kind: 'textarea'
      element: HTMLTextAreaElement | HTMLInputElement
      start: number
      end: number
      originalValue: string
      text: string
    }
  | {
      kind: 'contenteditable'
      element: HTMLElement
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

function fieldTarget(element: HTMLTextAreaElement | HTMLInputElement): CaptureTarget | null {
  const start = element.selectionStart ?? 0
  const selectedEnd = element.selectionEnd ?? start
  // A blurred field keeps its selection offsets, which is how a capture survives the focus change.
  const end = selectedEnd > start ? selectedEnd : element.value.length
  const effectiveStart = selectedEnd > start ? start : 0
  const text = element.value.slice(effectiveStart, end)
  if (!text.trim()) return null
  return { kind: 'textarea', element, start: effectiveStart, end, originalValue: element.value, text }
}

function rangeTarget(range: Range, windowRef: BrowserWindow): CaptureTarget {
  const text = range.toString()
  const editable = editableAncestor(range.commonAncestorContainer, windowRef)
  if (editable && editable.contains(range.startContainer) && editable.contains(range.endContainer)) {
    return { kind: 'contenteditable', element: editable, range, text }
  }
  return { kind: 'selection', text }
}

function wholeEditableTarget(element: HTMLElement, documentRef: Document): CaptureTarget | null {
  const text = element.innerText || element.textContent || ''
  if (!text.trim()) return null
  const range = documentRef.createRange()
  range.selectNodeContents(element)
  return { kind: 'contenteditable', element, range, text }
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
        start: index,
        end: index + hint.length,
        originalValue: value,
        text: hint,
      })
      continue
    }
    if (normalizeHint(value) === normalized) {
      targets.push({ kind: 'textarea', element, start: 0, end: value.length, originalValue: value, text: value })
    }
  }

  for (const element of editableTargets(documentRef)) {
    const readable = element.innerText || element.textContent || ''
    if (!readable) continue
    const range = rangeForText(element, hint, documentRef)
    if (range) {
      targets.push({ kind: 'contenteditable', element, range, text: range.toString() })
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

export function captureCurrentText(
  captures: Map<string, CaptureTarget>,
  documentRef: Document = document,
  windowRef: BrowserWindow = window,
  options: CaptureOptions = {}
): CaptureResponse {
  const hint = options.hintText || ''
  const normalizedHint = normalizeHint(hint)
  const candidates: CaptureTarget[] = []
  const add = (target: CaptureTarget | null): void => {
    if (target && target.text.trim()) candidates.push(target)
  }

  const active = deepActiveElement(documentRef)
  if (isTextField(active, windowRef)) add(fieldTarget(active))
  for (const range of selectionRanges(documentRef, windowRef)) add(rangeTarget(range, windowRef))
  if (active instanceof windowRef.HTMLElement && active.isContentEditable) {
    add(wholeEditableTarget(active, documentRef))
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
    return rememberCapture(captures, matching || { kind: 'selection', text: hint })
  }

  if (candidates.length > 0) return rememberCapture(captures, candidates[0])

  return {
    success: false,
    message: 'Select text or focus a textarea or contenteditable editor, or enter text manually.',
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
