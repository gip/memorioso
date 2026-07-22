import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CredentialRequest,
  IDKitRequestWidget,
  IDKitSessionWidget,
  any as anyCredential,
  type CredentialType,
  type IDKitResult,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import './sidepanel.css'

type User = { id: string; subject: string; handle: string }
type Session = { user: User; expiresAt: string }
type Capture = {
  tabId: number
  operationId?: string
  text: string
  canReplace: boolean
  message?: string
}
type SigningContext = {
  appId: `app_${string}`
  action: string
  environment: 'production' | 'staging'
  rpContext: RpContext
  signalText: string
  [key: string]: unknown
}
type SigningJob = {
  draftId: string
  signingId: string
  challengeId: string
  normalizedText: string
  author: { id: string; name: string; handle: string }
  context: SigningContext
  stage: 'proof' | 'prepared' | 'relayed' | 'finalized'
  registrationId?: string
  transactionHash?: string
  publicationId?: string
  tag?: string
}
type AuthContext = {
  attemptId: string
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}`
  allowedCredentials: CredentialType[]
}
type ExtensionResponse<T = Record<string, unknown>> = T & { success: boolean; message?: string }
const API_ORIGIN = (import.meta.env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz').replace(/\/$/, '')

async function send<T>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T>
  if (!response?.success) throw new Error(response?.message || 'The extension request failed')
  return response as T
}

function App(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [text, setText] = useState('')
  const [job, setJob] = useState<SigningJob | null>(null)
  const [handle, setHandle] = useState('')
  const [authContext, setAuthContext] = useState<AuthContext | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [proofOpen, setProofOpen] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<{ inserted: boolean; publicationUrl: string } | null>(null)

  useEffect(() => {
    send<{ session: Session | null; capture: Capture | null; job: SigningJob | null }>({ type: 'LIBRO_GET_SIGNING_STATE' })
      .then(async (state) => {
        setSession(state.session)
        setCapture(state.capture)
        setText(state.capture?.text || state.job?.normalizedText || '')
        setJob(state.job)
        if (state.session) {
          try {
            const restored = await send<Session>({ type: 'LIBRO_AUTH_SESSION' })
            setSession(restored)
          } catch {
            setSession(null)
          }
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not restore Libro'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return
      const nextCapture = changes.libroSigningCapture?.newValue as Capture | undefined
      if (nextCapture) {
        setCapture(nextCapture)
        setText(nextCapture.text)
      }
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const loginConstraints = useMemo(() => authContext
    ? anyCredential(...authContext.allowedCredentials.map((credential) => CredentialRequest(credential)))
    : null, [authContext])
  const publicationConstraints = useMemo(() => job
    ? CredentialRequest('proof_of_human', { signal: job.context.signalText })
    : null, [job])

  async function beginLogin(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setProgress('Connecting to Memorioso…')
    try {
      const context = await send<AuthContext>({ type: 'LIBRO_AUTH_CONTEXT', handle })
      setAuthContext(context)
      setLoginOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start World ID login')
    } finally {
      setProgress(null)
    }
  }

  async function verifyLogin(result: IDKitResultSession): Promise<void> {
    if (!authContext) throw new Error('The login attempt is missing')
    setProgress('Verifying your Memorioso author…')
    try {
      const restored = await send<Session>({
        type: 'LIBRO_AUTH_VERIFY',
        attemptId: authContext.attemptId,
        idkitResult: result,
      })
      setSession(restored)
      setLoginOpen(false)
      setAuthContext(null)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'World ID login failed'
      setError(message)
      throw reason
    } finally {
      setProgress(null)
    }
  }

  async function refreshCapture(): Promise<void> {
    setError(null)
    try {
      const response = await send<{ capture: Capture }>({ type: 'LIBRO_CAPTURE_ACTIVE_TEXT' })
      setCapture(response.capture)
      setText(response.capture.text)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not capture text')
    }
  }

  async function startSigning(): Promise<void> {
    setError(null)
    setCompletion(null)
    setProgress('Creating a public Memorioso publication…')
    try {
      const response = await send<{ job: SigningJob }>({ type: 'LIBRO_CREATE_SIGNATURE', text })
      setJob(response.job)
      setText(response.job.normalizedText)
      setProofOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the signing request')
    } finally {
      setProgress(null)
    }
  }

  async function finishAndInsert(startingJob: SigningJob): Promise<void> {
    let current = startingJob
    setError(null)
    try {
      if (current.stage === 'prepared') {
        setProgress('Sponsoring the World Chain registration…')
        const relayed = await send<{ job: SigningJob }>({ type: 'LIBRO_RELAY_SIGNATURE' })
        current = relayed.job
        setJob(current)
      }
      if (!current.tag) {
        setProgress('Finalizing the public publication…')
        const finalized = await send<{ job: SigningJob; publicationUrl: string }>({ type: 'LIBRO_FINALIZE_SIGNATURE' })
        current = finalized.job
        setJob(current)
      }
      setProgress('Returning the signed tag to the editor…')
      const inserted = await send<{ inserted: boolean; tag: string }>({ type: 'LIBRO_INSERT_TAG' })
      if (!inserted.inserted) await navigator.clipboard.writeText(inserted.tag)
      setCompletion({
        inserted: inserted.inserted,
        publicationUrl: `${API_ORIGIN}/p/${current.publicationId}`,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Signing could not be completed')
    } finally {
      setProgress(null)
    }
  }

  async function verifyPublication(result: IDKitResult): Promise<void> {
    setProgress('Verifying the World ID proof…')
    try {
      const prepared = await send<{ job: SigningJob }>({ type: 'LIBRO_PREPARE_SIGNATURE', idkitResult: result })
      setJob(prepared.job)
      setProofOpen(false)
      await finishAndInsert(prepared.job)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'World ID proof verification failed'
      setError(message)
      throw reason
    } finally {
      setProgress(null)
    }
  }

  async function signOut(): Promise<void> {
    await send({ type: 'LIBRO_AUTH_LOGOUT' })
    setSession(null)
    setJob(null)
    setCompletion(null)
  }

  async function cancel(): Promise<void> {
    await send({ type: 'LIBRO_CANCEL_SIGNATURE' })
    setJob(null)
    setCompletion(null)
    setError(null)
  }

  if (loading) return <main><p className="muted">Restoring Libro…</p></main>

  return (
    <main>
      <header>
        <div className="mark">L</div>
        <div><h1>Sign with Libro</h1><p>Human authorship, without leaving this page</p></div>
      </header>

      {authContext && loginConstraints && (
        <IDKitSessionWidget
          open={loginOpen}
          onOpenChange={setLoginOpen}
          app_id={authContext.appId}
          rp_context={authContext.rpContext}
          environment={authContext.environment}
          existing_session_id={authContext.existingSessionId}
          constraints={loginConstraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={verifyLogin}
          onSuccess={() => setLoginOpen(false)}
          onError={(code) => setError(`World ID login failed: ${code}`)}
        />
      )}
      {job && publicationConstraints && (
        <IDKitRequestWidget
          open={proofOpen}
          onOpenChange={setProofOpen}
          app_id={job.context.appId}
          action={job.context.action}
          rp_context={job.context.rpContext}
          environment={job.context.environment}
          constraints={publicationConstraints}
          allow_legacy_proofs={false}
          handleVerify={verifyPublication}
          onSuccess={() => setProofOpen(false)}
          onError={(code) => setError(`World ID verification failed: ${code}`)}
        />
      )}

      {error && <div className="notice error" role="alert">{error}</div>}
      {progress && <div className="notice progress" aria-live="polite"><span className="spinner" />{progress}</div>}

      {!session ? (
        <section>
          <h2>Connect your author</h2>
          <p className="muted">Use an existing Memorioso handle. Your World ID session confirms it belongs to you.</p>
          <form onSubmit={beginLogin}>
            <label htmlFor="handle">Memorioso handle</label>
            <div className="handle"><span>@</span><input id="handle" value={handle} onChange={(event) => setHandle(event.target.value)} autoComplete="username" required /></div>
            <button className="primary" disabled={Boolean(progress)}>Continue with World ID</button>
          </form>
          <a className="link" href={API_ORIGIN} target="_blank" rel="noreferrer">Create an author on Memorioso</a>
        </section>
      ) : completion && job?.tag ? (
        <section>
          <div className="success-mark">✓</div>
          <h2>Signed and published</h2>
          <p>{completion.inserted ? 'The Libro tag replaced the captured text.' : 'The editor changed or was unsupported, so the Libro tag was copied to your clipboard.'}</p>
          <textarea className="tag" readOnly value={job.tag} aria-label="Signed Libro tag" />
          <button onClick={() => navigator.clipboard.writeText(job.tag || '')}>Copy tag</button>
          <a className="button-link" href={completion.publicationUrl} target="_blank" rel="noreferrer">View publication</a>
          <button className="quiet" onClick={cancel}>Sign another text</button>
        </section>
      ) : (
        <section>
          <div className="account"><span>Connected as <strong>@{session.user.handle}</strong></span><button className="text-button" onClick={signOut}>Disconnect</button></div>
          <h2>{job ? 'Finish signing' : 'Review text'}</h2>
          {!job && <>
            <p className="muted">The normalized text below becomes a public Memorioso publication and an irreversible World Chain registration.</p>
            <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={12_000} placeholder="Enter the text you wrote…" />
            <div className="counter">{text.length.toLocaleString()} / 10,000 normalized characters</div>
            {capture?.message && !capture.text && <p className="hint">{capture.message}</p>}
            <button className="primary" onClick={startSigning} disabled={!text.trim() || Boolean(progress)}>Review World ID proof</button>
            <button onClick={refreshCapture}>Capture from page again</button>
          </>}
          {job?.stage === 'proof' && <>
            <p className="muted">Ready to prove that <strong>@{job.author.handle}</strong> wrote this text.</p>
            <blockquote>{job.normalizedText}</blockquote>
            <button className="primary" onClick={() => setProofOpen(true)} disabled={Boolean(progress)}>Continue with World ID</button>
            <button className="quiet" onClick={cancel}>Cancel signing</button>
          </>}
          {job && job.stage !== 'proof' && <>
            <p className="muted">Your proof is complete. The remaining sponsored registration can safely be retried.</p>
            <button className="primary" onClick={() => finishAndInsert(job)} disabled={Boolean(progress)}>Resume publishing</button>
          </>}
        </section>
      )}

      <footer>Bearer credentials remain in extension storage and are never sent to the page.</footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
