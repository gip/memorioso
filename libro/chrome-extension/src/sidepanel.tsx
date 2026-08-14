import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CredentialRequest,
  any as anyCredential,
  type CredentialType,
  type IDKitResult,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import {
  MEMORIOSO_SHORT_MAX_LENGTH,
  normalizedUnicodeLength,
} from '@libro/core'
import { WorldIdRequestDialog, WorldIdSessionDialog } from './world-id-dialog'
import './sidepanel.css'

type User = { id: number; subject: string; handle: string }
type Author = { id: string; name: string; handle: string; bio: string | null; isPrimary: boolean }
type Session = { user: User; author: Author; authors: Author[]; expiresAt: string }
type Capture = {
  tabId: number
  operationId?: string
  text: string
  canReplace: boolean
  message?: string
}
type AutoCapture = {
  enabled: boolean
  tabId: number
  reason?: 'navigated' | 'closed'
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
  version: 1
  draftId: string
  signingId: string
  challengeId: string
  normalizedText?: string
  author?: { id: string; name: string; handle: string }
  context?: SigningContext
  stage: 'proof' | 'prepared' | 'relayed' | 'finalized'
  registrationId?: string
  transactionHash?: string
  publicationId?: string
  tag?: string
}
type AuthContext = {
  intent: 'login' | 'signup'
  attemptId: string
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}` | null
  allowedCredentials: CredentialType[]
}
type HandleLookup =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'checking' }
  | { status: 'exists'; handle: string; canLogin: boolean }
  | { status: 'available'; handle: string }
  | { status: 'error'; message: string }
type SignupProfile = { handle: string; name: string; bio: string }
type ExtensionResponse<T = Record<string, unknown>> = T & { success: boolean; message?: string }
const API_ORIGIN = (import.meta.env.VITE_MEMORIOSO_APP_URL || 'https://www.memorioso.xyz').replace(/\/$/, '')
const USER_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidHandle(value: string): boolean {
  return USER_HANDLE_PATTERN.test(value)
}

function authorsForSession(session: Session | null): Author[] {
  if (!session) return []
  if (Array.isArray(session.authors) && session.authors.length > 0) return session.authors
  return session.author ? [{ ...session.author, isPrimary: true }] : []
}

async function send<T>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T>
  if (!response?.success) throw new Error(response?.message || 'The extension request failed')
  return response as T
}

export function App(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [text, setText] = useState('')
  const [job, setJob] = useState<SigningJob | null>(null)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [handleLookup, setHandleLookup] = useState<HandleLookup>({ status: 'idle' })
  const [pendingProfile, setPendingProfile] = useState<SignupProfile | null>(null)
  const [authContext, setAuthContext] = useState<AuthContext | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [proofOpen, setProofOpen] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [completion, setCompletion] = useState<{ inserted: boolean; publicationUrl: string } | null>(null)
  const [following, setFollowing] = useState(false)
  const [followPaused, setFollowPaused] = useState(false)
  const [followStopped, setFollowStopped] = useState<AutoCapture['reason'] | null>(null)
  const lookupSequence = useRef(0)
  // The page keeps pushing edits, so remember what it last sent and what the panel shows.
  const pageTextRef = useRef('')
  const textRef = useRef('')
  const jobRef = useRef<SigningJob | null>(null)
  const followingRef = useRef(false)

  useEffect(() => { textRef.current = text }, [text])
  useEffect(() => { jobRef.current = job }, [job])
  useEffect(() => { followingRef.current = following }, [following])

  // Closing the panel drops this port, which is how the service worker stops the page from following.
  useEffect(() => {
    const port = chrome.runtime.connect?.({ name: 'libro-side-panel' })
    return () => port?.disconnect()
  }, [])

  useEffect(() => {
    send<{
      session: Session | null
      capture: Capture | null
      job: SigningJob | null
      selectedAuthorId: string | null
      autoCapture: AutoCapture | null
      followPages: boolean
    }>({ type: 'LIBRO_GET_SIGNING_STATE' })
      .then(async (state) => {
        setSession(state.session)
        setSelectedAuthorId(state.selectedAuthorId)
        setCapture(state.capture)
        setText(state.capture?.text || state.job?.normalizedText || '')
        pageTextRef.current = state.capture?.text || ''
        setFollowing(Boolean(state.autoCapture?.enabled) || state.followPages)
        setJob(state.job)
        // Following is armed per panel, so a remembered preference has to arm it again on open.
        if (state.followPages && !state.autoCapture?.enabled) {
          send({ type: 'LIBRO_SET_AUTO_CAPTURE', enabled: true })
            .catch(() => setFollowing(false))
        }
        if (state.session) {
          try {
            const restored = await send<Session>({ type: 'LIBRO_AUTH_SESSION' })
            setSession(restored)
            const restoredAuthors = authorsForSession(restored)
            const preferred = restoredAuthors.find((author) => author.id === state.selectedAuthorId)
              || restoredAuthors.find((author) => author.isPrimary)
              || restoredAuthors[0]
            setSelectedAuthorId(preferred?.id || null)
          } catch {
            setSession(null)
          }
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not restore Libro'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const normalized = normalizeHandle(handle)
    const sequence = ++lookupSequence.current

    if (!normalized) {
      setHandleLookup({ status: 'idle' })
      return
    }
    if (!isValidHandle(normalized)) {
      setHandleLookup({ status: 'invalid' })
      return
    }

    setHandleLookup({ status: 'checking' })
    const timer = window.setTimeout(() => {
      send<{
        handle: string
        valid: boolean
        exists: boolean
        canLogin: boolean
      }>({ type: 'LIBRO_HANDLE_LOOKUP', handle: normalized })
        .then((response) => {
          if (sequence !== lookupSequence.current) return
          if (!response.valid) {
            setHandleLookup({ status: 'invalid' })
          } else if (response.exists) {
            setHandleLookup({ status: 'exists', handle: response.handle, canLogin: response.canLogin })
          } else {
            setHandleLookup({ status: 'available', handle: response.handle })
          }
        })
        .catch(() => {
          if (sequence === lookupSequence.current) {
            setHandleLookup({ status: 'error', message: 'Could not check that handle. Try again.' })
          }
        })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [handle])

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && changes.libroAutoCapture) {
        const auto = changes.libroAutoCapture.newValue as AutoCapture | undefined
        setFollowing(Boolean(auto?.enabled))
        setFollowStopped(auto?.enabled ? null : auto?.reason || null)
        if (!auto?.enabled) setFollowPaused(false)
      }
      if (areaName !== 'session') return
      const nextCapture = changes.libroSigningCapture?.newValue as Capture | undefined
      if (!nextCapture) return
      setCapture(nextCapture)
      // Text edited here, or already bound to a proof, outranks whatever the page reports.
      const editedHere = textRef.current.trim() !== '' && textRef.current !== pageTextRef.current
      if (jobRef.current) return
      if (editedHere) {
        if (followingRef.current) setFollowPaused(true)
        return
      }
      pageTextRef.current = nextCapture.text
      setText(nextCapture.text)
    }
    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const loginConstraints = useMemo(() => authContext
    ? anyCredential(...authContext.allowedCredentials.map((credential) => CredentialRequest(credential)))
    : null, [authContext])
  const publicationConstraints = useMemo(() => job?.stage === 'proof' && job.context
    ? CredentialRequest('proof_of_human', { signal: job.context.signalText })
    : null, [job])
  const normalizedTextLength = useMemo(() => normalizedUnicodeLength(text), [text])

  async function beginAuth(event: FormEvent): Promise<void> {
    event.preventDefault()
    const selection = handleLookup.status === 'exists' && handleLookup.canLogin
      ? { intent: 'login' as const, handle: handleLookup.handle }
      : handleLookup.status === 'available'
        ? { intent: 'signup' as const, handle: handleLookup.handle }
        : null
    if (!selection) return

    const profile = selection.intent === 'signup'
      ? { handle: selection.handle, name: name.trim(), bio: bio.trim() }
      : null
    if (profile && (profile.name.length < 3 || profile.name.length > 100 || profile.bio.length > 2000)) {
      setError('Name must be 3–100 characters and bio must be at most 2,000 characters.')
      return
    }

    setError(null)
    setAuthNotice(null)
    setProgress(selection.intent === 'signup' ? 'Preparing your new author…' : 'Connecting to Memorioso…')
    try {
      const context = await send<AuthContext>({
        type: 'LIBRO_AUTH_CONTEXT',
        handle: selection.handle,
        intent: selection.intent,
      })
      setPendingProfile(profile)
      setAuthContext(context)
      setLoginOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start World ID login')
    } finally {
      setProgress(null)
    }
  }

  async function verifyAuth(result: IDKitResultSession): Promise<void> {
    if (!authContext) throw new Error('The login attempt is missing')
    setProgress(authContext.intent === 'signup' ? 'Creating your Memorioso author…' : 'Verifying your Memorioso author…')
    try {
      const restored = await send<Session & { created: boolean; selectedAuthorId?: string | null }>({
        type: 'LIBRO_AUTH_VERIFY',
        attemptId: authContext.attemptId,
        idkitResult: result,
        profile: pendingProfile,
      })
      setSession(restored)
      const restoredAuthors = authorsForSession(restored)
      const selected = restoredAuthors.find((author) => author.id === restored.selectedAuthorId)
        || restoredAuthors.find((author) => author.isPrimary)
        || restoredAuthors[0]
      setSelectedAuthorId(selected?.id || null)
      if (authContext.intent === 'signup') {
        setAuthNotice(restored.created
          ? `Created @${restored.author.handle}. Your captured text is ready to review.`
          : `This World ID already owns @${restored.author.handle}, so that author was connected instead.`)
      }
      setLoginOpen(false)
      setAuthContext(null)
      setPendingProfile(null)
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
      pageTextRef.current = response.capture.text
      setFollowPaused(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not capture text')
    }
  }

  async function toggleFollowing(enabled: boolean): Promise<void> {
    setError(null)
    setFollowPaused(false)
    setFollowStopped(null)
    setFollowing(enabled)
    try {
      await send({ type: 'LIBRO_SET_AUTO_CAPTURE', enabled, remember: true })
    } catch (reason) {
      setFollowing(false)
      setError(reason instanceof Error ? reason.message : 'Could not follow this page')
    }
  }

  async function startSigning(): Promise<void> {
    const selectedAuthor = authorsForSession(session).find((author) => author.id === selectedAuthorId)
    if (!selectedAuthor) {
      setError('Choose an author before signing')
      return
    }
    setError(null)
    setCompletion(null)
    setProgress('Creating a public Memorioso publication…')
    try {
      const response = await send<{ job: SigningJob }>({
        type: 'LIBRO_CREATE_SIGNATURE',
        text,
        authorId: selectedAuthor.id,
      })
      setJob(response.job)
      setText(response.job.normalizedText || text)
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
        publicationUrl: `${API_ORIGIN}/short/${current.publicationId}`,
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
    setSelectedAuthorId(null)
    setJob(null)
    setCompletion(null)
    setAuthNotice(null)
  }

  async function selectAuthor(authorId: string): Promise<void> {
    if (!session || job) return
    setSelectedAuthorId(authorId)
    try {
      await send({ type: 'LIBRO_SELECT_AUTHOR', userId: session.user.id, authorId })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remember the selected author')
    }
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
        {/* This Vite extension cannot use Next.js image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mark" src="/icon-128.png" alt="" />
        <div><h1>Sign with Libro</h1><p>Human authorship, without leaving this page</p></div>
      </header>

      {authContext && loginConstraints && (
        <WorldIdSessionDialog
          open={loginOpen}
          onOpenChange={setLoginOpen}
          app_id={authContext.appId}
          rp_context={authContext.rpContext}
          environment={authContext.environment}
          existing_session_id={authContext.existingSessionId || undefined}
          constraints={loginConstraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={verifyAuth}
          onError={(code) => setError(`World ID login failed: ${code}`)}
        />
      )}
      {job?.stage === 'proof' && job.context && publicationConstraints && (
        <WorldIdRequestDialog
          open={proofOpen}
          onOpenChange={setProofOpen}
          app_id={job.context.appId}
          action={job.context.action}
          rp_context={job.context.rpContext}
          environment={job.context.environment}
          constraints={publicationConstraints}
          allow_legacy_proofs={false}
          handleVerify={verifyPublication}
          onError={(code) => setError(`World ID verification failed: ${code}`)}
        />
      )}

      {error && <div className="notice error" role="alert">{error}</div>}
      {authNotice && <div className="notice info" aria-live="polite">{authNotice}</div>}
      {progress && <div className="notice progress" aria-live="polite"><span className="spinner" />{progress}</div>}

      {!session ? (
        <section>
          <h2>Connect or create your author</h2>
          <p className="muted">Enter a handle to connect an existing author or create your first one.</p>
          <form onSubmit={beginAuth}>
            <label htmlFor="handle">Memorioso handle</label>
            <div className="handle">
              <span>@</span>
              <input
                id="handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="lookup-status" aria-live="polite">
              {handleLookup.status === 'checking' && 'Checking availability…'}
              {handleLookup.status === 'invalid' && 'Handles are 3–32 characters: lowercase letters, numbers, - or _.'}
              {handleLookup.status === 'exists' && handleLookup.canLogin && `@${handleLookup.handle} exists. World ID will confirm it belongs to you.`}
              {handleLookup.status === 'exists' && !handleLookup.canLogin && `@${handleLookup.handle} is taken and cannot be used to log in.`}
              {handleLookup.status === 'available' && `@${handleLookup.handle} is available.`}
              {handleLookup.status === 'error' && handleLookup.message}
            </div>
            {handleLookup.status === 'available' && (
              <div className="profile-fields">
                <label htmlFor="name">Public name</label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  minLength={3}
                  maxLength={100}
                  placeholder="Your name"
                  required
                />
                <div className="field-help">Required · 3–100 characters</div>
                <label htmlFor="bio">Bio <span className="optional">(optional)</span></label>
                <textarea
                  id="bio"
                  className="profile-bio"
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  maxLength={2000}
                  placeholder="What do you write about?"
                />
                <div className="counter">{bio.length.toLocaleString()} / 2,000</div>
              </div>
            )}
            {handleLookup.status === 'exists' && handleLookup.canLogin && (
              <button className="primary" disabled={Boolean(progress)}>
                Continue as @{handleLookup.handle} with World ID
              </button>
            )}
            {handleLookup.status === 'available' && (
              <button
                className="primary"
                disabled={name.trim().length < 3 || name.trim().length > 100 || Boolean(progress)}
              >
                Create @{handleLookup.handle} with World ID
              </button>
            )}
          </form>
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
            <label>
              Publish as
              <select
                value={selectedAuthorId || ''}
                onChange={(event) => selectAuthor(event.target.value)}
                disabled={Boolean(progress)}
              >
                {authorsForSession(session).map((author) => (
                  <option key={author.id} value={author.id}>{author.name} (@{author.handle})</option>
                ))}
              </select>
            </label>
            <p className="muted">The normalized text below becomes a public Memorioso publication and an irreversible World Chain registration.</p>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Enter the text you wrote…"
            />
            <div className="counter">
              {normalizedTextLength.toLocaleString()} / {MEMORIOSO_SHORT_MAX_LENGTH.toLocaleString()} normalized characters
            </div>
            {following && !followPaused && (
              <p className="hint">Following this page. Moving to another editor or selecting new text updates this.</p>
            )}
            {following && followPaused && (
              <p className="hint">
                Following paused because you edited here.{' '}
                <button className="text-button" onClick={refreshCapture}>Resume following</button>
              </p>
            )}
            {!following && followStopped && (
              <p className="hint">
                Following stopped because the page {followStopped === 'closed' ? 'closed' : 'navigated'}.
                Capture again to restart it.
              </p>
            )}
            {capture?.message && !capture.text && <p className="hint">{capture.message}</p>}
            <button
              className="primary"
              onClick={startSigning}
              disabled={normalizedTextLength === 0 || normalizedTextLength > MEMORIOSO_SHORT_MAX_LENGTH || Boolean(progress)}
            >
              Review World ID proof
            </button>
            <button onClick={refreshCapture}>Capture from page again</button>
            <label className="follow-toggle">
              <input
                type="checkbox"
                checked={following}
                onChange={(event) => toggleFollowing(event.target.checked)}
              />
              Follow this page automatically
            </label>
          </>}
          {job?.stage === 'proof' && <>
            <p className="muted">Ready to prove that <strong>@{job.author?.handle}</strong> wrote this text.</p>
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

const rootElement = document.getElementById('root')
if (rootElement) {
  createRoot(rootElement).render(<App />)
}
