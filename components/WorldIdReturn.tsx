'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { pollMobileRequest } from '@/lib/world-id/mobile-bridge'
import { completeMobileFlow } from '@/lib/world-id/mobile-complete'
import { readMobileFlow, removeMobileFlow, safeReturnPath, saveMobileFlow, type MobileFlow } from '@/lib/world-id/mobile-store'

export function WorldIdReturn() {
  const [flow, setFlow] = useState<MobileFlow | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('flow') || ''
    let active = true
    let running = false
    let stopped = false
    let controller = new AbortController()
    const recoveryTimer = setTimeout(() => { setShowRecovery(true) }, 4000)
    const tick = async () => {
      if (!active || running || stopped || document.visibilityState === 'hidden') return
      if (controller.signal.aborted) controller = new AbortController()
      running = true
      try {
        if (!navigator.locks) throw new Error('Resume this verification in the browser where you started it.')
        await navigator.locks.request(`world-id:${id}`, { ifAvailable: true }, async (lock) => {
          if (!lock || !active) return
          const saved = readMobileFlow(id)
          if (!saved) throw new Error('This verification expired or is not available in this browser. Return to Memorioso and start again.')
          if (saved.completed) {
            stopped = true
            setFlow(saved)
            setBusy(false)
            if (saved.completed.destination) window.location.replace(safeReturnPath(saved.completed.destination, window.location.origin))
            return
          }
          if (!saved.result && !saved.prepared) {
            if (!saved.connectorURI) {
              throw new Error('This verification is incomplete. Return to Memorioso and start again.')
            }
            if (!active) return
            setFlow({ ...saved })
            const url = new URL(window.location.href)
            if (url.searchParams.get('launch') === '1') {
              // Consume the launch before leaving so back/reload cannot reopen World App.
              url.searchParams.delete('launch')
              window.history.replaceState(window.history.state, '', url.href)
              window.location.assign(saved.connectorURI)
              return
            }
            const result = await pollMobileRequest(saved, controller.signal)
            if (!result) return
            saved.result = result
            saveMobileFlow(saved)
          }
          if (!active || document.visibilityState === 'hidden') return
          setBusy(true)
          await completeMobileFlow(saved, window.location.origin)
          if (active) {
            const completed = readMobileFlow(id)
            setFlow(completed)
            setBusy(false)
            stopped = true
            if (completed?.completed?.destination) window.location.replace(safeReturnPath(completed.completed.destination, window.location.origin))
          }
        })
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          stopped = true
          setBusy(false)
          setError(reason instanceof Error ? reason.message : 'Could not resume World ID verification')
        }
      } finally { running = false }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 1500)
    const resume = () => { void tick() }
    const pause = () => { controller.abort() }
    const visibility = () => { if (document.visibilityState === 'hidden') pause(); else resume() }
    window.addEventListener('pageshow', resume)
    window.addEventListener('pagehide', pause)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      controller.abort()
      clearInterval(timer)
      clearTimeout(recoveryTimer)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('pagehide', pause)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [attempt])

  const leave = async () => {
    const id = new URL(window.location.href).searchParams.get('flow') || ''
    const destination = safeReturnPath(flow?.completed?.destination || flow?.returnPath || '/', window.location.origin)
    // Wait for any in-flight finalization before deleting its recovery checkpoint.
    if (navigator.locks) await navigator.locks.request(`world-id:${id}`, () => {
      const current = readMobileFlow(id)
      if (!current?.prepared && !current?.completed) removeMobileFlow(id)
    })
    window.location.replace(destination)
  }

  return <main className="mx-auto max-w-md space-y-5 px-4 py-12">
    {flow?.completed ? <>
      <p role="status">{flow.completed.message}</p>
    </> : <>
      {!error && <p role="status">{!busy && showRecovery ? 'Waiting for verification in World App…' : 'Completing verification…'}</p>}
      {showRecovery && !busy && flow?.connectorURI && !error && <Button asChild><a href={flow.connectorURI} rel="noreferrer">Open World App</a></Button>}
      {showRecovery && !busy && !error && <p className="text-sm text-muted-foreground">If World App did not open, use the button above. After verifying, switch back to this browser if you are not returned automatically.</p>}
      {error && <>
        <p role="alert">{error}</p>
        <Button onClick={() => { setError(''); setAttempt((value) => value + 1) }}>Resume verification</Button>
      </>}
    </>}
    {(error || showRecovery && !flow?.completed?.destination) && <div><Button variant="ghost" disabled={busy} onClick={() => { void leave() }}>Return to Memorioso</Button></div>}
  </main>
}
