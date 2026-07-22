export type CaptureTarget =
  | {
      kind: 'textarea'
      element: HTMLTextAreaElement
      start: number
      end: number
      originalValue: string
      text: string
    }
  | {
      kind: 'contenteditable'
      element: HTMLElement
      range: Range
      originalHtml: string
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

type BrowserWindow = Window & typeof globalThis

function editableAncestor(node: Node | null, view: BrowserWindow): HTMLElement | null {
  const element = node instanceof view.HTMLElement ? node : node?.parentElement
  return element?.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])') || null
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
  windowRef: BrowserWindow = window
): CaptureResponse {
  const active = documentRef.activeElement
  if (active instanceof windowRef.HTMLTextAreaElement) {
    const start = active.selectionStart ?? 0
    const selectedEnd = active.selectionEnd ?? start
    const end = selectedEnd > start ? selectedEnd : active.value.length
    const effectiveStart = selectedEnd > start ? start : 0
    const text = active.value.slice(effectiveStart, end)
    if (text) {
      return rememberCapture(captures, {
        kind: 'textarea',
        element: active,
        start: effectiveStart,
        end,
        originalValue: active.value,
        text,
      })
    }
  }

  const selection = windowRef.getSelection()
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const range = selection.getRangeAt(0).cloneRange()
    const text = range.toString()
    if (text) {
      const editable = editableAncestor(range.commonAncestorContainer, windowRef)
      if (editable && editable.contains(range.startContainer) && editable.contains(range.endContainer)) {
        return rememberCapture(captures, {
          kind: 'contenteditable',
          element: editable,
          range,
          originalHtml: editable.innerHTML,
          text,
        })
      }
      return rememberCapture(captures, { kind: 'selection', text })
    }
  }

  if (active instanceof windowRef.HTMLElement && active.isContentEditable) {
    const text = active.innerText || active.textContent || ''
    if (text) {
      const range = documentRef.createRange()
      range.selectNodeContents(active)
      return rememberCapture(captures, {
        kind: 'contenteditable',
        element: active,
        range,
        originalHtml: active.innerHTML,
        text,
      })
    }
  }

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

  if (target.element.innerHTML !== target.originalHtml || target.range.toString() !== target.text) {
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
