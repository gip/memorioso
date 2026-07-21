'use client'

import { useCallback, useState } from 'react'
import {
  CredentialRequest,
  IDKitSessionWidget,
  any as anyCredential,
  enumerate,
  setDebug,
  type ConstraintNode,
  type IDKitDebugReport,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import { Button } from '@/components/ui/button'
import { WORLD_ID_ALLOWED_CREDENTIALS, type WorldIdCredentialIdentifier } from '@/lib/world-id/constants'

type ConstraintMode = 'all' | 'enumerate' | WorldIdCredentialIdentifier

type TestContext = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  mode: ConstraintMode
}

type TestOutcome =
  | { kind: 'result'; result: IDKitResultSession }
  | { kind: 'error'; errorCode: string; debugReport?: IDKitDebugReport }

function buildConstraints(mode: ConstraintMode): ConstraintNode {
  if (mode === 'all') {
    return anyCredential(...WORLD_ID_ALLOWED_CREDENTIALS.map((credential) => CredentialRequest(credential)))
  }
  if (mode === 'enumerate') {
    return enumerate(...WORLD_ID_ALLOWED_CREDENTIALS.map((credential) => CredentialRequest(credential)))
  }
  return anyCredential(CredentialRequest(mode))
}

export default function SessionTestPage() {
  const [context, setContext] = useState<TestContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const startTest = useCallback(async (mode: ConstraintMode) => {
    setOutcome(null)
    setStartError(null)
    setCopied(false)
    setDebug(true)

    let body: unknown
    try {
      const response = await fetch('/api/worldid/rp-context', { cache: 'no-store' })
      body = await response.json()
      if (!response.ok) {
        throw new Error('Could not fetch RP context')
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Could not fetch RP context')
      return
    }

    const { appId, environment, rpContext } = body as Omit<TestContext, 'mode'>
    setContext({ appId, environment, rpContext, mode })
    setIsOpen(true)
  }, [])

  const outcomeJson = outcome
    ? JSON.stringify(outcome.kind === 'result' ? outcome.result : outcome, null, 2)
    : null

  const copyOutcome = useCallback(async () => {
    if (!outcomeJson) return
    await navigator.clipboard.writeText(outcomeJson)
    setCopied(true)
  }, [outcomeJson])

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <h2 className="text-2xl font-bold">World ID Session Test</h2>
      <p className="mt-2 text-sm text-gray-500">
        Runs the same IDKit session flow as the login on the home page, but with debug logging
        always on, no <code>existing_session_id</code>, and the raw error code or session result
        shown below. Each button requests a different constraint shape to isolate which one
        World App fails to handle.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => startTest('all')}>any(all credentials)</Button>
        <Button variant="outline" onClick={() => startTest('enumerate')}>enumerate(all credentials)</Button>
        {WORLD_ID_ALLOWED_CREDENTIALS.map((credential) => (
          <Button key={credential} variant="outline" onClick={() => startTest(credential)}>
            {credential} only
          </Button>
        ))}
      </div>
      {context && (
        <p className="mt-2 text-xs text-gray-500">
          app: {context.appId} · environment: {context.environment} · constraints: {context.mode} ·
          nonce: {context.rpContext.nonce}
        </p>
      )}
      {startError && <p className="mt-2 text-sm text-red-600">{startError}</p>}

      {outcome && (
        <div className="mt-8">
          <p className={`text-sm font-medium ${outcome.kind === 'result' ? 'text-green-700' : 'text-red-600'}`}>
            {outcome.kind === 'result'
              ? `Got a session proof (session_id: ${outcome.result.session_id.slice(0, 20)}…). The session flow works; the login problem is elsewhere.`
              : `Session request failed with error code "${outcome.errorCode}".`}
          </p>
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-lg font-bold">Raw result</h3>
            <Button variant="outline" size="sm" onClick={copyOutcome}>
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
          <pre className="mt-2 text-xs bg-gray-200 p-4 rounded-xl overflow-x-auto break-all whitespace-pre-wrap">
            {outcomeJson}
          </pre>
        </div>
      )}

      {context && (
        <IDKitSessionWidget
          key={context.rpContext.nonce}
          open={isOpen}
          onOpenChange={setIsOpen}
          app_id={context.appId}
          rp_context={context.rpContext}
          environment={context.environment}
          constraints={buildConstraints(context.mode)}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={async (result: IDKitResultSession) => {
            setOutcome({ kind: 'result', result })
          }}
          onError={(errorCode, debugReport) => {
            setOutcome({ kind: 'error', errorCode, debugReport })
          }}
          onSuccess={() => {
            setIsOpen(false)
          }}
        />
      )}
    </div>
  )
}
