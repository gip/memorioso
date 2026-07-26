// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureCurrentText,
  replaceCapture,
  resyncCapture,
  watchCapture,
  type CaptureTarget,
} from './capture'

describe('inline text capture and replacement', () => {
  let captures: Map<string, CaptureTarget>

  beforeEach(() => {
    document.body.replaceChildren()
    window.getSelection()?.removeAllRanges()
    captures = new Map()
  })

  it('captures and replaces a textarea selection', () => {
    const editor = document.createElement('textarea')
    editor.value = 'One human sentence here.'
    document.body.append(editor)
    editor.focus()
    editor.setSelectionRange(4, 18)
    const onInput = vi.fn()
    editor.addEventListener('input', onInput)

    const capture = captureCurrentText(captures)
    expect(capture).toMatchObject({ success: true, text: 'human sentence', canReplace: true })
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.value).toBe('One [signed] here.')
    expect(onInput).toHaveBeenCalledOnce()
  })

  it('falls back to the whole focused textarea when no text is selected', () => {
    const editor = document.createElement('textarea')
    editor.value = 'The whole note'
    document.body.append(editor)
    editor.focus()
    editor.setSelectionRange(0, 0)

    const capture = captureCurrentText(captures)
    expect(capture.text).toBe('The whole note')
    replaceCapture(captures, capture.operationId!, 'Libro tag')
    expect(editor.value).toBe('Libro tag')
  })

  it('replaces an unchanged contenteditable selection', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.textContent = 'Before selected after'
    document.body.append(editor)
    editor.focus()
    const range = document.createRange()
    range.setStart(editor.firstChild!, 7)
    range.setEnd(editor.firstChild!, 15)
    window.getSelection()?.addRange(range)

    const capture = captureCurrentText(captures)
    expect(capture).toMatchObject({ success: true, text: 'selected', canReplace: true })
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.textContent).toBe('Before [signed] after')
  })

  it('refuses to overwrite a target that changed or disappeared', () => {
    const changed = document.createElement('textarea')
    changed.value = 'Original'
    document.body.append(changed)
    changed.focus()
    const first = captureCurrentText(captures)
    changed.value = 'Edited while signing'
    expect(replaceCapture(captures, first.operationId!, 'tag')).toMatchObject({
      success: false,
      message: expect.stringContaining('changed'),
    })

    const removed = document.createElement('textarea')
    removed.value = 'Original'
    document.body.append(removed)
    removed.focus()
    const second = captureCurrentText(captures)
    removed.remove()
    expect(replaceCapture(captures, second.operationId!, 'tag')).toMatchObject({
      success: false,
      message: expect.stringContaining('disappeared'),
    })
  })

  it('captures a non-editor selection but requires clipboard fallback', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Selected page copy'
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection()?.addRange(range)

    const capture = captureCurrentText(captures)
    expect(capture).toMatchObject({ success: true, text: 'Selected page copy', canReplace: false })
    expect(replaceCapture(captures, capture.operationId!, 'tag')).toMatchObject({ success: false })
  })

  it('offers manual entry when there is no supported source', () => {
    expect(captureCurrentText(captures)).toMatchObject({
      success: false,
      message: expect.stringContaining('enter text manually'),
    })
  })

  it('captures a textarea selection after the editor lost focus to the panel', () => {
    const editor = document.createElement('textarea')
    editor.value = 'One human sentence here.'
    document.body.append(editor)
    editor.focus()
    editor.setSelectionRange(4, 18)
    editor.blur()

    const capture = captureCurrentText(captures)
    expect(capture).toMatchObject({ success: true, text: 'human sentence', canReplace: true })
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.value).toBe('One [signed] here.')
  })

  it('captures the editor inside an open shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'Composed in a shadow editor'
    shadow.append(editor)
    editor.focus()

    const capture = captureCurrentText(captures)
    expect(capture).toMatchObject({ success: true, text: 'Composed in a shadow editor', canReplace: true })
  })

  it('resolves the context menu selection when the page reports nothing', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const editor = document.createElement('textarea')
    editor.value = 'Prefix. The signed sentence. Suffix.'
    shadow.append(editor)

    const capture = captureCurrentText(captures, document, window, { hintText: 'The signed sentence.' })
    expect(capture).toMatchObject({ success: true, text: 'The signed sentence.', canReplace: true })
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.value).toBe('Prefix. [signed] Suffix.')
  })

  it('follows later edits of a fully captured field', () => {
    const editor = document.createElement('textarea')
    editor.value = 'A human sentence.'
    document.body.append(editor)
    editor.focus()

    const capture = captureCurrentText(captures)
    editor.value = 'A human sentence. And a second one.'
    expect(resyncCapture(captures, capture.operationId!)).toMatchObject({
      text: 'A human sentence. And a second one.',
      canReplace: true,
    })
    expect(resyncCapture(captures, capture.operationId!)).toBeNull()

    // The capture stays replaceable against the text the panel now shows.
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.value).toBe('[signed]')
  })

  it('keeps a captured selection anchored while the rest of the field changes', () => {
    const editor = document.createElement('textarea')
    editor.value = 'Intro. The signed part. Outro.'
    document.body.append(editor)
    editor.focus()
    editor.setSelectionRange(7, 23)

    const capture = captureCurrentText(captures)
    expect(capture.text).toBe('The signed part.')
    editor.value = 'A longer intro. The signed part. Outro.'
    expect(resyncCapture(captures, capture.operationId!)).toMatchObject({ text: 'The signed part.' })

    editor.value = 'A longer intro. The signed and edited part. Outro.'
    expect(resyncCapture(captures, capture.operationId!)).toMatchObject({
      text: 'The signed and edited part.',
    })
    expect(replaceCapture(captures, capture.operationId!, '[signed]')).toEqual({ success: true })
    expect(editor.value).toBe('A longer intro. [signed] Outro.')
  })

  it('reports edits through a debounced watcher and stops on demand', () => {
    vi.useFakeTimers()
    try {
      const editor = document.createElement('textarea')
      editor.value = 'First draft.'
      document.body.append(editor)
      editor.focus()

      const capture = captureCurrentText(captures)
      const updates: string[] = []
      const watcher = watchCapture(captures, capture.operationId!, (update) => updates.push(update.text || ''))

      editor.value = 'Second draft.'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      editor.value = 'Third draft.'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      expect(updates).toEqual([])

      vi.advanceTimersByTime(300)
      expect(updates).toEqual(['Third draft.'])

      watcher.stop()
      editor.value = 'Ignored draft.'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      vi.advanceTimersByTime(300)
      expect(updates).toEqual(['Third draft.'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the context menu selection even when it cannot be located on the page', () => {
    const capture = captureCurrentText(captures, document, window, { hintText: 'Text from another frame' })
    expect(capture).toMatchObject({
      success: true,
      text: 'Text from another frame',
      canReplace: false,
    })
  })
})
