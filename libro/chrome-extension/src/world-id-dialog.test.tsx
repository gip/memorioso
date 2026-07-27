// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { WorldIdDialog, WorldIdQrCode } from './world-id-dialog'

afterEach(() => {
  document.body.replaceChildren()
})

describe('WorldIdQrCode', () => {
  it('renders its SVG in a narrow side panel', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<WorldIdQrCode value="https://world.org/verify?t=test-connection" />)
    })

    const svg = container.querySelector<SVGElement>('[data-testid="world-id-qr"]')
    const modules = svg?.querySelector('path')
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/)
    expect(modules?.getAttribute('d')?.length).toBeGreaterThan(500)

    await act(async () => root.unmount())
  })
})

describe('WorldIdDialog', () => {
  it('keeps the QR flow visible at side-panel width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const flow = {
      open: () => undefined,
      reset: () => undefined,
      isAwaitingUserConnection: false,
      isAwaitingUserConfirmation: false,
      isSuccess: false,
      isError: false,
      connectorURI: 'https://world.org/verify?t=test-connection',
      result: null,
      errorCode: null,
    }

    await act(async () => {
      root.render(
        <WorldIdDialog
          open
          onOpenChange={() => undefined}
          handleVerify={() => undefined}
          environment="production"
          flow={flow}
        />,
      )
    })

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="world-id-qr"]')).not.toBeNull()
    expect(container.textContent).toContain('Scan this QR code with World App.')

    await act(async () => root.unmount())
  })
})
