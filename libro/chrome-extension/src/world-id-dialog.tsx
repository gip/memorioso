import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  useIDKitRequest,
  useIDKitSession,
  type IDKitErrorCodes,
  type IDKitRequestHookConfig,
  type IDKitResult,
  type IDKitResultSession,
  type IDKitSessionHookConfig,
  type UseIDKitRequestHookResult,
  type UseIDKitSessionHookResult,
} from '@worldcoin/idkit'

type MaybePromise<T> = Promise<T> | T
type WorldIdFlow<T> = Pick<
  UseIDKitRequestHookResult | UseIDKitSessionHookResult,
  | 'open'
  | 'reset'
  | 'isAwaitingUserConnection'
  | 'isAwaitingUserConfirmation'
  | 'isSuccess'
  | 'isError'
  | 'connectorURI'
  | 'errorCode'
> & { result: T | null }

type DialogProps<T> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  handleVerify: (result: T) => MaybePromise<void>
  onError?: (errorCode: IDKitErrorCodes) => void
  environment?: 'production' | 'staging' | 'sandbox'
  flow: WorldIdFlow<T>
}

type SharedWidgetProps<T> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  handleVerify: (result: T) => MaybePromise<void>
  onError?: (errorCode: IDKitErrorCodes) => void
}

export type WorldIdRequestDialogProps = IDKitRequestHookConfig & SharedWidgetProps<IDKitResult>
export type WorldIdSessionDialogProps = IDKitSessionHookConfig & SharedWidgetProps<IDKitResultSession>

function WorldIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        d="M30.737 9.772A15.97 15.97 0 0 0 16 0 15.97 15.97 0 0 0 1.26 9.772 15.97 15.97 0 0 0 0 15.998a15.97 15.97 0 0 0 9.771 14.742A15.97 15.97 0 0 0 16 32a15.97 15.97 0 0 0 14.74-9.772A15.97 15.97 0 0 0 32 15.998a15.97 15.97 0 0 0-1.263-6.226ZM16 3.006c3.47 0 6.73 1.351 9.185 3.806l.22.228h-8.96a8.93 8.93 0 0 0-6.335 2.626 8.91 8.91 0 0 0-2.5 4.832H3.093a12.89 12.89 0 0 1 3.718-7.686A12.9 12.9 0 0 1 16 3.006Zm10.91 8.383a12.8 12.8 0 0 1 1.993 3.106H10.685a5.96 5.96 0 0 1 5.76-4.449h10.229c.08.44.16.888.236 1.343Zm1.993 6.112a12.8 12.8 0 0 1-1.35 4.449H16.445a5.96 5.96 0 0 1-5.76-4.449h18.218ZM16 28.994a12.9 12.9 0 0 1-9.188-3.806 12.89 12.89 0 0 1-3.718-7.683H7.61a8.91 8.91 0 0 0 2.5 4.833 8.93 8.93 0 0 0 6.335 2.626h8.96l-.216.228A12.9 12.9 0 0 1 16 28.994Z"
      />
    </svg>
  )
}

export function WorldIdQrCode({ value }: { value: string }): JSX.Element {
  const qr = useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }), [value])
  const margin = 4
  const viewBoxSize = qr.modules.size + margin * 2
  const path = useMemo(() => {
    let cells = ''
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let column = 0; column < qr.modules.size; column += 1) {
        if (qr.modules.get(row, column)) {
          cells += `M${column + margin} ${row + margin}h1v1h-1z`
        }
      }
    }
    return cells
  }, [qr])

  return (
    <svg
      className="world-id-qr"
      data-testid="world-id-qr"
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      role="img"
      aria-label="World ID connection QR code"
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="white" />
      <path d={path} fill="black" />
    </svg>
  )
}

export function WorldIdDialog<T>({
  open,
  onOpenChange,
  handleVerify,
  onError,
  environment,
  flow,
}: DialogProps<T>): JSX.Element | null {
  const [hostState, setHostState] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')
  const handledResult = useRef<T | null>(null)
  const handledError = useRef<IDKitErrorCodes | null>(null)
  const { open: openFlow, reset: resetFlow } = flow

  useEffect(() => {
    if (open) {
      handledResult.current = null
      handledError.current = null
      setHostState('idle')
      openFlow()
    } else {
      handledResult.current = null
      handledError.current = null
      setHostState('idle')
      resetFlow()
    }
  }, [open, openFlow, resetFlow])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open || !flow.isError || !flow.errorCode || handledError.current === flow.errorCode) return
    handledError.current = flow.errorCode
    onError?.(flow.errorCode)
  }, [flow.errorCode, flow.isError, onError, open])

  useEffect(() => {
    if (!open || !flow.isSuccess || !flow.result || handledResult.current === flow.result) return
    handledResult.current = flow.result
    setHostState('verifying')
    void Promise.resolve(handleVerify(flow.result))
      .then(() => setHostState('success'))
      .catch(() => setHostState('error'))
  }, [flow.isSuccess, flow.result, handleVerify, open])

  if (!open) return null

  const retry = () => {
    handledResult.current = null
    handledError.current = null
    setHostState('idle')
    resetFlow()
    openFlow()
  }
  const failed = flow.isError || hostState === 'error'
  const waitingForHost = hostState === 'verifying' || hostState === 'success'

  return (
    <div className="world-id-backdrop" role="presentation" onClick={() => onOpenChange(false)}>
      <section
        className="world-id-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-id-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="world-id-close" type="button" onClick={() => onOpenChange(false)} aria-label="Close">
          ×
        </button>
        <div className="world-id-content">
          <div className="world-id-icon"><WorldIcon /></div>
          {failed ? (
            <>
              <h2 id="world-id-dialog-title">Connection failed</h2>
              <p className="muted">World ID could not complete this request. Please try again.</p>
              <button className="primary world-id-action" type="button" onClick={retry}>Try again</button>
            </>
          ) : waitingForHost ? (
            <>
              <h2 id="world-id-dialog-title">{hostState === 'success' ? 'All set' : 'Verifying your World ID'}</h2>
              <p className="muted">{hostState === 'success' ? 'Your World ID is connected.' : 'Transmitting verification to Memorioso…'}</p>
              {hostState === 'verifying' && <span className="spinner world-id-spinner" aria-hidden="true" />}
            </>
          ) : (
            <>
              <h2 id="world-id-dialog-title">Connect your World ID</h2>
              <p className="muted">Scan this QR code with World App.</p>
              <div className={flow.isAwaitingUserConfirmation ? 'world-id-qr-frame connecting' : 'world-id-qr-frame'}>
                {flow.connectorURI ? <WorldIdQrCode value={flow.connectorURI} /> : <div className="world-id-qr-placeholder" />}
                {flow.isAwaitingUserConfirmation && (
                  <div className="world-id-connecting">
                    <span className="spinner" aria-hidden="true" />
                    <strong>Continue in World App</strong>
                  </div>
                )}
              </div>
              {flow.connectorURI && (
                <a className="world-id-open-link" href={flow.connectorURI} target="_blank" rel="noreferrer">
                  Open World App instead
                </a>
              )}
              {environment === 'staging' && flow.connectorURI && (
                <a
                  className="world-id-simulator-link"
                  href={`https://simulator.worldcoin.org?connect_url=${encodeURIComponent(flow.connectorURI)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Use the staging simulator
                </a>
              )}
              {flow.isAwaitingUserConnection && !flow.connectorURI && <span className="spinner world-id-spinner" aria-hidden="true" />}
            </>
          )}
        </div>
        <div className="world-id-footer">
          <a href="https://developer.world.org/privacy-statement" target="_blank" rel="noreferrer">Terms &amp; Privacy</a>
        </div>
      </section>
    </div>
  )
}

export function WorldIdRequestDialog({
  open,
  onOpenChange,
  handleVerify,
  onError,
  ...config
}: WorldIdRequestDialogProps): JSX.Element | null {
  const flow = useIDKitRequest(config)
  return (
    <WorldIdDialog
      open={open}
      onOpenChange={onOpenChange}
      handleVerify={handleVerify}
      onError={onError}
      environment={config.environment}
      flow={flow}
    />
  )
}

export function WorldIdSessionDialog({
  open,
  onOpenChange,
  handleVerify,
  onError,
  ...config
}: WorldIdSessionDialogProps): JSX.Element | null {
  const flow = useIDKitSession(config)
  return (
    <WorldIdDialog
      open={open}
      onOpenChange={onOpenChange}
      handleVerify={handleVerify}
      onError={onError}
      environment={config.environment}
      flow={flow}
    />
  )
}
