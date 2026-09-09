'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { IDKitSessionWidget } from '@worldcoin/idkit'
import { createMobileRequest, signalHashes } from '@/lib/world-id/mobile-bridge'
import { callbackUrl, canUseMobileFlow, MOBILE_FLOW_TTL, pruneMobileFlows, safeReturnPath, saveMobileFlow, type MobileOperation } from '@/lib/world-id/mobile-store'

type Props = ComponentProps<typeof IDKitSessionWidget> & { mobileOperation: MobileOperation }

export function WorldIdSessionWidget({ mobileOperation, ...props }: Props) {
  const [mobile, setMobile] = useState<boolean | null>(null)
  const started = useRef(false)
  const mounted = useRef(false)
  const [error, setError] = useState('')
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    mounted.current = true
    setMobile(canUseMobileFlow())
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!mobile || !props.open || started.current) return
    started.current = true
    const start = async () => {
      try {
        pruneMobileFlows()
        const origin = window.location.origin
        const configured = process.env.NEXT_PUBLIC_APP_URL
        if (configured && new URL(configured).origin !== origin) throw new Error('Open this verification on the configured Memorioso website.')
        const id = crypto.randomUUID()
        const flow = {
          version: 1 as const, id,
          expiresAt: Math.min(Date.now() + MOBILE_FLOW_TTL, props.rp_context.expires_at * 1000),
          returnPath: safeReturnPath(window.location.href, origin),
          config: {
            app_id: props.app_id, rp_context: props.rp_context, environment: props.environment,
            require_user_presence: props.require_user_presence,
          },
          existingSessionId: props.existing_session_id,
          signalHashes: signalHashes(props.constraints),
          operation: mobileOperation,
        }
        // The signal can contain a draft title/subtitle. Only its hashes survive
        // navigation; the original constraints are used in memory by IDKit here.
        const connectorURI = await createMobileRequest(flow, props.constraints, origin)
        if (!mounted.current || !latest.current.open) { started.current = false; return }
        saveMobileFlow({ ...flow, connectorURI })
        window.location.assign(`${callbackUrl(id, origin)}&launch=1`)
      } catch (reason) {
        if (!mounted.current) return
        setError(reason instanceof Error ? reason.message : 'Could not save verification on this device')
        setMobile(false)
      }
    }
    void start()
  }, [mobile, props, mobileOperation])
  if (mobile === null) return null
  if (!mobile) return <>{error && <p role="alert">{error}</p>}<IDKitSessionWidget {...props} /></>
  return props.open ? <p role={error ? 'alert' : 'status'}>{error || 'Opening World ID verification…'}</p> : null
}
