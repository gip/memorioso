// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureCurrentText, replaceCapture, type CaptureTarget } from './capture'

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
})
