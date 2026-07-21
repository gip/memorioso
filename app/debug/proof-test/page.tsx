'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  IDKitRequestWidget,
  proofOfHuman,
  setDebug,
  type IDKitDebugReport,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit'
import { Button } from '@/components/ui/button'

const TEST_ACTION = 'memorioso-proof-test'

type TestContext = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
}

type TestOutcome =
  | { kind: 'result'; result: IDKitResult }
  | { kind: 'error'; errorCode: string; debugReport?: IDKitDebugReport }

function describeOutcome(outcome: TestOutcome): { tone: string; message: string } {
  if (outcome.kind === 'error') {
    return {
      tone: 'text-red-600',
      message: `Request failed with error code "${outcome.errorCode}". Codes like credential_unavailable or world_id_4_not_available mean this account has no usable v4 proof_of_human credential.`,
    }
  }

  const result = outcome.result
  if (result.protocol_version === '4.0' && 'action' in result) {
    const identifiers = result.responses.map((response) => response.identifier).join(', ')
    return {
      tone: 'text-green-700',
      message: `Got a World ID 4.0 uniqueness proof (credentials: ${identifiers || 'none'}). This account holds a v4 credential, so the problem is likely in the session flow or RP configuration.`,
    }
  }

  if (result.protocol_version === '3.0') {
    return {
      tone: 'text-amber-600',
      message: 'Got a legacy World ID 3.0 proof via the fallback. This account did not produce a v4 proof — likely not migrated to World ID 4.0 in this environment.',
    }
  }

  return {
    tone: 'text-amber-600',
    message: 'Got an unexpected result shape. See the raw JSON below.',
  }
}

export default function ProofTestPage() {
  const [context, setContext] = useState<TestContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const preset = useMemo(() => proofOfHuman(), [])

  const startTest = useCallback(async () => {
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

    const { appId, environment, rpContext } = body as TestContext & { success: true }
    setContext({ appId, environment, rpContext })
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
      <h2 className="text-2xl font-bold">World ID Proof Test</h2>
      <p className="mt-2 text-sm text-gray-500">
        Runs a one-shot IDKit request with the ProofOfHuman preset (no session), with legacy v3
        fallback allowed, using action <code>{TEST_ACTION}</code>. Use this to check whether your
        World App account returns a v4 proof at all.
      </p>

      <div className="mt-6">
        <Button onClick={startTest}>Run ProofOfHuman test</Button>
        {context && (
          <p className="mt-2 text-xs text-gray-500">
            app: {context.appId} · environment: {context.environment} · nonce: {context.rpContext.nonce}
          </p>
        )}
        {startError && <p className="mt-2 text-sm text-red-600">{startError}</p>}
      </div>

      {outcome && (
        <div className="mt-8">
          <p className={`text-sm font-medium ${describeOutcome(outcome).tone}`}>
            {describeOutcome(outcome).message}
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
        <IDKitRequestWidget
          key={context.rpContext.nonce}
          open={isOpen}
          onOpenChange={setIsOpen}
          app_id={context.appId}
          action={TEST_ACTION}
          rp_context={context.rpContext}
          environment={context.environment}
          allow_legacy_proofs={true}
          preset={preset}
          polling={{ interval: 1000, timeout: 120_000 }}
          onSuccess={(result) => {
            setOutcome({ kind: 'result', result })
            setIsOpen(false)
          }}
          onError={(errorCode, debugReport) => {
            setOutcome({ kind: 'error', errorCode, debugReport })
          }}
        />
      )}
    </div>
  )
}
