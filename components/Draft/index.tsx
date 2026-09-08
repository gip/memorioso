'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DeleteDraftDialog } from '@/components/DeleteDraftDialog'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ArrowRight, FileText, MessageSquareText, MoreVertical, Trash2, Check, Loader2 } from 'lucide-react'
import { FeedItem } from '@/components/FeedItem'
import {
  IDKitSessionWidget,
  CredentialRequest,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import { useUserOperationReceipt } from '@worldcoin/minikit-react'
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider'
import { type Author } from '@/types'
import Editor from '@/components/Editor'
import { ShortEditor } from '@/components/ShortEditor'
import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { type PublicationAccess, type PublicationContent } from '@/types'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from '@/lib/local-draft'
import { DRAFT_ENCRYPTION_V1, encryptDraft } from '@/lib/draft-crypto'
import { useDraftKey } from '@/lib/draft-crypto/provider'
import { revealDraftRow } from '@/lib/draft-crypto/rows'
import { DraftLockNotice } from '@/components/DraftLockNotice'
import { DraftEncryptionSetup } from '@/components/DraftPassphrase'
import {
  isNativeLibroTransactionAvailable,
  sendLibroRegistrationTransaction,
} from '@/lib/libro/client'
import {
  FinalizePublicationError,
  finalizePublicationWithRetry,
  type FinalizePublishPayload,
} from '@/lib/libro/finalize-client'
import { SigningClient } from '@/components/Libro/SigningClient'
import type { LibroRegistrationTransaction } from '@/lib/libro/proof'
import { createLibroPublicClient, hasMeaningfulPublicationBody } from '@libro/core'
import {
  type PublicationKind,
  publicationPath,
  validatePublicationForKind,
} from '@/lib/publication-kind'
import { announceDraftShortcutUpdate } from '@/lib/draft-events'
import { reconcileOwnedAuthorId } from '@/lib/authors'

type DraftData = {
  id?: string
  status?: string
  title: string
  subtitle: string
  content: PublicationContent
  authorId?: string
  history?: unknown
  publicationType: PublicationKind
  access?: PublicationAccess
}

type PublishContext = {
  challengeId: string
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}`
  signalText: string
  signalHash: string
}

type PreparePublishResponse =
  | {
      success: true
      registrationId: string
      transaction: LibroRegistrationTransaction
    }
  | {
      success: false
      message?: string
      error?: string
    }

type RelayPublishResponse =
  | {
      success: true
      transactionHash: string
    }
  | {
      success: false
      message?: string
    }

type PendingFinalize = {
  draftId: string
  payload: FinalizePublishPayload
}

const AlertDestructive = ({ message }: { message: string }) => {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Attention</AlertTitle>
      <AlertDescription>
        {message}
      </AlertDescription>
    </Alert>
  )
}

const PUBLISH_STEPS = [
  'Verify you are human',
  'Prepare registration',
  'Submit registration',
  'Register on-chain',
  'Finalize publication',
]

const PublishProgress = ({ step, status }: { step: number; status: string | null }) => (
  <Alert>
    <AlertTitle>Publishing</AlertTitle>
    <AlertDescription>
      <ol className="mt-2 space-y-1.5">
        {PUBLISH_STEPS.map((label, index) => {
          const done = index < step
          const active = index === step
          return (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  done
                    ? 'bg-green-600 text-white'
                    : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? '✓' : index + 1}
              </span>
              <span className={active ? 'font-medium' : done ? '' : 'text-muted-foreground'}>
                {active && status ? status : label}
              </span>
            </li>
          )
        })}
      </ol>
    </AlertDescription>
  </Alert>
)

export const Draft = ({ draftId, initialType }: { draftId: string | null; initialType: PublicationKind | null }) => {
  const [draft, setDraft] = useState<DraftData | null>({
    title: '',
    subtitle: '',
    content: { html: '' },
    publicationType: initialType || 'article',
    access: 'public',
  })
  const [originalDraft, setOriginalDraft] = useState<DraftData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditingDisabled, setIsEditingDisabled] = useState<boolean>(false)
  const router = useRouter()
  const [authors, setAuthors] = useState<Author[]>([])
  const [areAuthorsLoaded, setAreAuthorsLoaded] = useState(false)
  const [initialContent, setInitialContent] = useState<Object | null>(null)
  const [initialTitle, setInitialTitle] = useState<string>('')
  const [initialSubtitle, setInitialSubtitle] = useState<string>('')
  const [initialAuthorId, setInitialAuthorId] = useState<string | null>(null)
  const [publishContext, setPublishContext] = useState<PublishContext | null>(null)
  const [isWorldIdOpen, setIsWorldIdOpen] = useState(false)
  const [externalSigningUrl, setExternalSigningUrl] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<string | null>(null)
  const [publishStep, setPublishStep] = useState<number | null>(null)
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'saved-local' | 'locked' | 'error'>('idle')
  // Anonymous drafts live in local storage until login; the editor must not mount
  // before we know whether there is something to restore into it.
  const [isLocalRestored, setIsLocalRestored] = useState(false)
  const [hasChosenType, setHasChosenType] = useState(Boolean(draftId || initialType))
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDraftLocked, setIsDraftLocked] = useState(false)
  const [pendingFinalize, setPendingFinalize] = useState<PendingFinalize | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishHostVerifyError = useRef<string | null>(null)
  const authorsUserIdRef = useRef<number | null>(null)
  const { status, user, signInWithWorldId } = useWorldIdAuth()
  const { status: draftKeyStatus, key: draftKey } = useDraftKey()
  const isAuthenticated = status === 'authenticated'
  // An authenticated writer whose device has no key cannot save to their
  // account without writing prose the database is not supposed to hold. An
  // author who has not yet chosen counts as locked too: the choice dialog is up,
  // and until it is answered there is no telling which shape a save should take.
  // So does one whose choice could not be read: unknown is not permission to
  // guess.
  const isDraftKeyLocked = isAuthenticated && (
    draftKeyStatus === 'locked' || draftKeyStatus === 'unset' || draftKeyStatus === 'unavailable'
  )
  const { isInstalled: isMiniKitInstalled } = useMiniKit()
  const canUseWorldWallet = isMiniKitInstalled === true && isNativeLibroTransactionAvailable()
  const publicClient = useMemo(
    () => createLibroPublicClient(process.env.NEXT_PUBLIC_LIBRO_RPC_URL),
    []
  )
  const { poll: pollUserOperationReceipt, isLoading: isPollingRegistration } = useUserOperationReceipt({
    client: publicClient,
  })

  useEffect(() => {
    setCurrentDraftId(draftId)
  }, [draftId])

  useEffect(() => {
    if (status !== 'authenticated' || loading || !currentDraftId || !draft) return
    announceDraftShortcutUpdate({
      id: currentDraftId,
      title: draft.title,
      content: draft.content,
      publicationType: draft.publicationType,
    })
  }, [currentDraftId, draft, loading, status])

  // Restore anonymous work into a fresh editor. Only for /d/new: an existing
  // draft id always wins over whatever is on this device.
  useEffect(() => {
    if (draftId) {
      setIsLocalRestored(true)
      return
    }
    const local = readLocalDraft()
    if (local) {
      setDraft({
        title: local.title,
        subtitle: local.subtitle,
        content: local.content,
        publicationType: local.publicationType,
      })
      setHasChosenType(true)
      setInitialContent(local.content.html)
      setInitialTitle(local.title)
      setInitialSubtitle(local.subtitle)
      window.history.replaceState(null, '', `/d/new?type=${local.publicationType}`)
    }
    setIsLocalRestored(true)
  }, [draftId])

  const setContent = ({ html }: { html: string }) => {
    setDraft((prevDraft) => prevDraft ? { ...prevDraft, content: { html } } as DraftData : null)
  }

  const setTitle = (title: string) => {
    setDraft((prevDraft) => prevDraft ? { ...prevDraft, title } : null)
  }

  const setSubtitle = (subtitle: string) => {
    setDraft((prevDraft) => prevDraft ? { ...prevDraft, subtitle } : null)
  }

  // Waits for the key before loading an existing draft: opening the editor on a
  // locked draft would show an empty document, and autosave would then be one
  // keystroke away from overwriting the writer's work with that emptiness.
  useEffect(() => {
    if (draftId && draftKeyStatus === 'loading') return

    let cancelled = false
    const fetchDraft = async () => {
      if (!draftId) {
        setLoading(false)
        return
      }

      try {
        const raw = await fetch(`/api/draft/${draftId}`)
        const response = await raw.json()
        if (!response.success) {
          router.push('/')
          return
        }

        const revealed = await revealDraftRow(response.data, draftKey, user?.id ?? null)
        if (cancelled) return

        if (revealed.locked) {
          setIsDraftLocked(true)
          setLoading(false)
          return
        }

        setIsDraftLocked(false)
        setDraft(revealed as unknown as DraftData)
        setOriginalDraft(revealed as unknown as DraftData)
        setInitialContent(revealed.content.html)
        setInitialTitle(revealed.title)
        setInitialSubtitle(revealed.subtitle)
        setInitialAuthorId(response.data.authorId)
        setHasChosenType(true)
      } catch (error) {
        console.error('Failed to fetch draft:', error)
        router.push('/')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDraft()
    return () => {
      cancelled = true
    }
  }, [draftId, router, draftKey, draftKeyStatus, user?.id])

  const fetchAuthors = useCallback(async () => {
    const expectedUserId = user?.id ?? null
    if (status !== 'authenticated' || expectedUserId === null) return

    try {
      const raw = await fetch('/api/authors', { cache: 'no-store' })
      const response = await raw.json()
      if (authorsUserIdRef.current !== expectedUserId) return
      if (raw.ok && response.success) {
        setAuthors(response.authors)
        setAreAuthorsLoaded(true)
      }
    } catch (error) {
      console.error('Failed to fetch authors:', error)
    }
  }, [status, user?.id])

  // Author state belongs to one authenticated user. App Router can preserve
  // this client component across navigations, so discard both the list and its
  // selection before asking for the next login's author.
  useEffect(() => {
    const authenticatedUserId = status === 'authenticated' ? user?.id ?? null : null
    authorsUserIdRef.current = authenticatedUserId
    setAuthors([])
    setAreAuthorsLoaded(false)
    setDraft((prev) => prev?.authorId ? { ...prev, authorId: undefined } : prev)

    if (authenticatedUserId === null) return
    fetchAuthors()
  }, [fetchAuthors, status, user?.id])

  // Every login owns exactly one author. Preserve an attached id only while it
  // is present in this login's freshly loaded list; a previous login's id must
  // be replaced rather than sent to the save API.
  useEffect(() => {
    if (!user || !areAuthorsLoaded) return
    setDraft((prev) => {
      if (!prev) return prev
      const authorId = reconcileOwnedAuthorId(prev.authorId, authors)
      return authorId === prev.authorId ? prev : { ...prev, authorId }
    })
  }, [areAuthorsLoaded, authors, user, loading, draft?.authorId])

  // Prose leaves the browser sealed. The envelope is bound to the draft id, so
  // a new draft picks its id here rather than taking one from the server and
  // having to encrypt a second time.
  const buildSavePayload = async (draftToSave: DraftData, id: string) => {
    const { title, subtitle, content, ...rest } = draftToSave

    // This author declined a passphrase, so their prose is stored the way it was
    // before encryption existed. They were told what that means when they chose.
    if (draftKeyStatus === 'disabled') {
      return { ...rest, id, encryption: 'none', title, subtitle, content }
    }

    if (!draftKey || !user) {
      throw new Error('Your drafts are locked on this device')
    }

    return {
      ...rest,
      id,
      encryption: DRAFT_ENCRYPTION_V1,
      ciphertext: await encryptDraft(
        draftKey,
        { draftId: id, userId: user.id },
        { title, subtitle, content }
      ),
    }
  }

  const handleSave = async () => {
    try {
      let raw: Response, response: any
      const draftToSave = draft
      if (!draftToSave) throw new Error('Draft is unavailable')
      if (!currentDraftId) {
        const newDraftId = crypto.randomUUID()
        raw = await fetch(`/api/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(await buildSavePayload(draftToSave, newDraftId)),
        })
        response = await raw.json()
        if (response.success) {
          // Adopt the new id without remounting, so typing/focus survives autosave.
          const savedDraft = response.draft as DraftData
          const newId: string = savedDraft.id as string
          setCurrentDraftId(newId)
          setOriginalDraft(draftToSave ? { ...draftToSave, id: newId, status: savedDraft.status } : savedDraft)
          setDraft((prev) => (prev ? { ...prev, id: newId, status: savedDraft.status } : prev))
          window.history.replaceState(null, '', `/d/${newId}`)
          clearLocalDraft()
          return savedDraft
        }
      } else {
        raw = await fetch(`/api/draft/${currentDraftId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(await buildSavePayload(draftToSave, currentDraftId)),
        })
        response = await raw.json()
        if (response.success) {
          const savedDraft = response.draft as DraftData
          setOriginalDraft(draftToSave ? { ...draftToSave, status: savedDraft.status } : savedDraft)
          return savedDraft
        }
      }
      throw new Error(response?.message || 'Failed to save draft')
    } catch (error) {
      console.error('Failed to save draft:', error)
      throw error
    }
  }

  // signInWithWorldId resolves once the login modal is on screen, not once the
  // writer is actually signed in. So this only hands over to that modal;
  // adoption persists the draft, and the writer publishes after.
  const handleSignInToPublish = () => {
    setIsConfirmOpen(false)
    setError(null)
    signInWithWorldId().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Could not start World ID login')
    })
  }

  const waitForExternalLibroPublication = async (draftId: string): Promise<void> => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const raw = await fetch(`/api/draft/${draftId}/publish/status`, { cache: 'no-store' })
      const response = await raw.json().catch(() => null)
      if (raw.ok && response?.state === 'finalized' && response.publicationId) {
        clearLocalDraft()
        router.replace(`${publicationPath(draft?.publicationType || 'article', response.publicationId)}?signed=1`)
        return
      }
      if (response?.state === 'expired') throw new Error('Libro signing request expired before it was completed')
      if (!raw.ok && raw.status !== 502) throw new Error(response?.message || 'Libro publication status failed')
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    throw new Error('Libro signing is still pending. Reopen the draft to resume status checks.')
  }

  const handlePublish = async () => {
    try {
      setIsConfirmOpen(false)
      setError(null)
      setPublishStatus(null)
      setPublishStep(0)
      publishHostVerifyError.current = null
      setIsEditingDisabled(true)
      // Cancel any pending autosave; we save explicitly here.
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      const saved = await handleSave()
      // currentDraftId state may be stale right after a first save; use the returned draft.
      const publishDraftId: string | null = saved?.id || currentDraftId
      if (!publishDraftId || !draft?.authorId) throw new Error('Draft ID or Author ID is missing')

      // Publishing is the one moment the server needs the prose: it builds the
      // payload the World ID proof is taken over. The stored draft is encrypted,
      // so it comes from here, decrypted, rather than from the database.
      const raw = await fetch('/api/world-id/publish-context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draftId: publishDraftId,
          title: draft?.title ?? '',
          subtitle: draft?.subtitle ?? '',
          content: draft?.content ?? { html: '' },
        }),
      })
      const response = await raw.json().catch(() => null)
      if (!response) throw new Error(`Failed to start publication signing (HTTP ${raw.status})`)

      if (raw.ok && response.success) {
        if (typeof response.externalSigningUrl === 'string') {
          setExternalSigningUrl(response.externalSigningUrl)
          setPublishStep(1)
          setPublishStatus('Sign your publication with World ID')
          await waitForExternalLibroPublication(publishDraftId)
          return
        }
        const nextPublishContext: PublishContext = {
          challengeId: response.challengeId,
          appId: response.appId,
          environment: response.environment,
          rpContext: response.rpContext,
          existingSessionId: response.existingSessionId,
          signalText: response.signalText,
          signalHash: response.signalHash,
        }
        setPublishContext(nextPublishContext)
        setIsWorldIdOpen(true)
      } else {
        throw new Error(response.message || 'Failed to start World ID verification')
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('Error during publish:', error)
        setError(error.message || 'Failed to verify draft')
      } else {
        console.error('Error during publish:', error)
        setError('Failed to verify draft')
      }
      setPublishStep(null)
      setIsEditingDisabled(false)
    }
  }

  const completeFinalization = useCallback(async (pending: PendingFinalize): Promise<boolean> => {
    setPendingFinalize(pending)
    setError(null)
    setPublishStep(4)
    setPublishStatus('Finalizing publication')
    setIsEditingDisabled(true)

    try {
      const response = await finalizePublicationWithRetry(
        `/api/draft/${pending.draftId}/publish/finalize`,
        pending.payload
      )
      setPendingFinalize(null)
      setPublishStatus(null)
      publishHostVerifyError.current = null
      clearLocalDraft()
      // Replace, not push: the draft is consumed and its local copy is gone, so
      // leaving it in history only gives Back a dead editor to return to.
      router.replace(`${publicationPath(response.publicationType || draft?.publicationType || 'article', response.publicationId)}?signed=1`)
      return true
    } catch (reason) {
      if (reason instanceof FinalizePublicationError && reason.retryable) {
        const message = 'Your on-chain registration is confirmed, but publication finalization is temporarily busy. Resume finalization to try again.'
        publishHostVerifyError.current = message
        setError(message)
        setPublishStatus(null)
        setPublishStep(null)
        setIsEditingDisabled(true)
        return false
      }

      const message = reason instanceof Error ? reason.message : 'Failed to finalize publication'
      setPendingFinalize(null)
      publishHostVerifyError.current = message
      setError(message)
      setPublishStatus(null)
      setPublishStep(null)
      setIsEditingDisabled(false)
      throw reason
    }
  }, [router, draft?.publicationType])

  const handleWorldIdResult = async (idkitResult: IDKitResultSession) => {
    if (!publishContext || !currentDraftId) {
      throw new Error('Publish challenge is missing')
    }

    try {
      setPublishStep(1)
      setPublishStatus('Preparing on-chain registration')
      const prepareRaw = await fetch(`/api/draft/${currentDraftId}/publish/prepare`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          challengeId: publishContext.challengeId,
          idkitResult,
        }),
      })
      const prepareResponse = await prepareRaw.json().catch(() => ({
        success: false,
        message: `Publish prepare returned ${prepareRaw.status}`,
      })) as PreparePublishResponse

      if (!prepareRaw.ok) {
        const message = prepareResponse.success
          ? `Publish prepare returned ${prepareRaw.status}`
          : prepareResponse.error || prepareResponse.message || `Publish prepare returned ${prepareRaw.status}`
        publishHostVerifyError.current = message
        setError(message)
        throw new Error(message)
      }

      if (!prepareResponse.success) {
        const message = prepareResponse.error || prepareResponse.message || `Publish prepare returned ${prepareRaw.status}`
        publishHostVerifyError.current = message
        setError(message)
        throw new Error(message)
      }

      let submissionMethod: 'world_wallet' | 'memorioso_relayer'
      let userOpHash: string | undefined
      let transactionHash: string

      if (isNativeLibroTransactionAvailable()) {
        submissionMethod = 'world_wallet'
        setPublishStep(2)
        setPublishStatus('Waiting for approval from your World wallet')
        const walletResult = await sendLibroRegistrationTransaction(prepareResponse.transaction)
        userOpHash = walletResult.userOpHash

        setPublishStep(3)
        setPublishStatus('Waiting for World wallet registration')
        const receipt = await pollUserOperationReceipt(userOpHash)
        transactionHash = receipt.transactionHash
      } else {
        submissionMethod = 'memorioso_relayer'
        setPublishStep(2)
        setPublishStatus('Submitting a sponsored registration')
        const relayRaw = await fetch(`/api/draft/${currentDraftId}/publish/relay`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ registrationId: prepareResponse.registrationId }),
        })
        const relayResponse = await relayRaw.json().catch(() => ({
          success: false,
          message: `Sponsored registration returned ${relayRaw.status}`,
        })) as RelayPublishResponse

        if (!relayRaw.ok || !relayResponse.success) {
          throw new Error(
            relayResponse.success
              ? `Sponsored registration returned ${relayRaw.status}`
              : relayResponse.message || 'Failed to submit sponsored registration'
          )
        }

        transactionHash = relayResponse.transactionHash
        setPublishStep(3)
        setPublishStatus('Sponsored registration confirmed')
      }

      const finalized = await completeFinalization({
        draftId: currentDraftId,
        payload: {
          registrationId: prepareResponse.registrationId,
          submissionMethod,
          userOpHash,
          transactionHash,
        },
      })
      if (!finalized) return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish'
      publishHostVerifyError.current = message
      setError(message)
      setPublishStatus(null)
      setPublishStep(null)
      if (!pendingFinalize) setIsEditingDisabled(false)
      throw error
    }
  }

  const handleDelete = async () => {
    if (!currentDraftId) return
    setIsDeleting(true)
    setError(null)
    try {
      const raw = await fetch(`/api/draft/${currentDraftId}`, {
        method: 'DELETE',
      })
      const response = await raw.json() as { success?: boolean; message?: string }
      if (!raw.ok || !response.success) {
        throw new Error(response.message || 'Failed to delete draft')
      }

      setIsDeleteConfirmOpen(false)
      clearLocalDraft()
      router.push('/')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete draft')
    } finally {
      setIsDeleting(false)
    }
  }

  const isDraftChanged = useCallback(() => {
    return JSON.stringify(draft) !== JSON.stringify(originalDraft)
  }, [draft, originalDraft])

  // Keep the in-memory save ref pointing at the latest closure for autosave.
  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  const hasText =
    (draft?.title?.trim()?.length ?? 0) > 0 ||
    (draft?.subtitle?.trim()?.length ?? 0) > 0 ||
    hasMeaningfulPublicationBody(draft?.content)
  const publicationValidationError = draft ? validatePublicationForKind({
    kind: draft.publicationType,
    title: draft.title,
    subtitle: draft.subtitle,
    content: draft.content,
  }) : 'Draft is unavailable'
  const canPublish = publicationValidationError === null
  const isDraftAuthorReady = areAuthorsLoaded && Boolean(
    draft?.authorId && authors.some((author) => author.id === draft.authorId)
  )

  // Debounced autosave: no Save button, work is never lost. Anonymous writers
  // are saved to this device instead of the account.
  useEffect(() => {
    if (isEditingDisabled || !hasText) return
    // A locked writer keeps saving to this device rather than to their account:
    // the work survives, and no prose reaches a database that cannot hold it.
    const shouldSaveLocally = status !== 'authenticated' || isDraftKeyLocked || !isDraftAuthorReady
    if (!shouldSaveLocally && !isDraftChanged()) return

    setSaveState('saving')
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      if (shouldSaveLocally) {
        const stored = writeLocalDraft({
          publicationType: draft?.publicationType ?? 'article',
          title: draft?.title ?? '',
          subtitle: draft?.subtitle ?? '',
          content: draft?.content ?? { html: '' },
        })
        setSaveState(stored ? (isDraftKeyLocked ? 'locked' : 'saved-local') : 'error')
        return
      }
      try {
        await handleSaveRef.current()
        setSaveState('saved')
      } catch {
        // A rejected first save must not turn Refresh into data loss. The one
        // local slot is cleared as soon as a later account save succeeds.
        const stored = !currentDraftId && draft ? writeLocalDraft({
          publicationType: draft.publicationType,
          title: draft.title,
          subtitle: draft.subtitle,
          content: draft.content,
        }) : false
        setSaveState(stored ? 'saved-local' : 'error')
      }
    }, 1200)

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [draft, isEditingDisabled, isDraftChanged, hasText, status, isDraftKeyLocked, isDraftAuthorReady, currentDraftId])

  // Adoption: the moment the writer signs in, their local draft becomes a real
  // draft on their account. handleSave adopts the new id and rewrites the URL
  // without remounting, so typing is not interrupted.
  const isAdoptingRef = useRef(false)
  useEffect(() => {
    // 'disabled' adopts too: that author saves prose by their own choice, and
    // leaving the local copy behind means it reappears in the next new draft.
    if (status !== 'authenticated') return
    if (draftKeyStatus !== 'unlocked' && draftKeyStatus !== 'disabled') return
    if (!isDraftAuthorReady) return
    if (currentDraftId || draftId) return
    if (!isLocalRestored || !hasText || isEditingDisabled) return
    // Only adopt work that was actually written anonymously. Without this an
    // already-signed-in writer would skip the autosave debounce and create a
    // draft on their first keystroke.
    if (!readLocalDraft()) return
    if (isAdoptingRef.current) return

    isAdoptingRef.current = true
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    setSaveState('saving')
    handleSaveRef.current()
      .then(() => {
        clearLocalDraft()
        setSaveState('saved')
        return fetchAuthors()
      })
      .catch(() => {
        setSaveState('error')
      })
      .finally(() => {
        isAdoptingRef.current = false
      })
  }, [status, draftKeyStatus, currentDraftId, draftId, isLocalRestored, hasText, isEditingDisabled, fetchAuthors, isDraftAuthorReady])

  if (status === 'loading' || loading || !isLocalRestored) {
    return <FeedItem item={null} />
  }

  // A draft that exists but will not open: show the way back in rather than an
  // empty editor that autosave would then write over.
  if (isDraftLocked) {
    return (
      <div className="py-8">
        <DraftLockNotice title="This draft is locked" />
      </div>
    )
  }

  if (!draftId && !hasChosenType && !readLocalDraft()) {
    return (
      <div className="mx-auto max-w-xl py-8 text-center sm:py-16">
        <h1 className="spectral text-2xl font-semibold sm:text-3xl">What are you publishing?</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:mt-3 sm:text-base">Choose a format before you begin.</p>
        <div className="mt-5 grid gap-2.5 sm:mt-8 sm:grid-cols-2 sm:gap-3">
          {(['short', 'article'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                // Keep any author already attached; dropping it here would leave
                // the publish confirmation disabled until a reload.
                setDraft((prev) => ({
                  title: '',
                  subtitle: '',
                  content: { html: '' },
                  publicationType: kind,
                  authorId: prev?.authorId,
                }))
                setHasChosenType(true)
                router.replace(`/d/new?type=${kind}`)
              }}
              className="group flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blurple/30 hover:shadow-md sm:block sm:p-6"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blurple/10 text-blurple sm:mb-4 sm:h-10 sm:w-10">
                {kind === 'short' ? <MessageSquareText className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold capitalize sm:text-lg">{kind}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground sm:mt-2 sm:text-sm">
                  {kind === 'short' ? 'Plain text · 500 characters' : 'Title, formatting and images'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-blurple sm:hidden" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  const worldIdConstraints = publishContext
    ? CredentialRequest('proof_of_human', { signal: publishContext.signalText })
    : null

  const selectedAuthor = authors.find((a) => a.id === draft?.authorId) || null

  return (
    <div className="space-y-3 pb-10 pt-2 sm:space-y-4 sm:py-4">
      {publishContext && worldIdConstraints && (
        <IDKitSessionWidget
          open={isWorldIdOpen}
          onOpenChange={(open) => {
            setIsWorldIdOpen(open)
            if (!open && !publishStatus && !pendingFinalize) {
              setIsEditingDisabled(false)
            }
          }}
          app_id={publishContext.appId}
          rp_context={publishContext.rpContext}
          existing_session_id={publishContext.existingSessionId}
          environment={publishContext.environment}
          constraints={worldIdConstraints}
          handleVerify={handleWorldIdResult}
          onSuccess={() => {
            setIsWorldIdOpen(false)
          }}
          onError={(errorCode) => {
            if (errorCode === 'failed_by_host_app' && publishHostVerifyError.current) {
              setError(publishHostVerifyError.current)
            } else {
              setError(`World ID verification failed: ${errorCode}`)
            }
            if (!pendingFinalize) setIsEditingDisabled(false)
          }}
        />
      )}
      {error && <AlertDestructive message={error} />}
      {/* The one-time choice, asked where it starts to matter rather than at sign-in. */}
      <DraftEncryptionSetup />
      {(draftKeyStatus === 'locked' || draftKeyStatus === 'unavailable') && isAuthenticated && <DraftLockNotice />}
      {publishStep !== null && (<>
        {externalSigningUrl && <div className="my-4 space-y-3">
          <SigningClient capability={new URL(externalSigningUrl).pathname.split('/').pop()!} />
        </div>}
        <PublishProgress step={publishStep} status={publishStatus} />
      </>)}
      {/* Parks below the mobile bar and aligns to the shared 700px column on desktop. */}
      <div className="sticky top-14 z-20 -mx-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-background/95 px-4 py-2.5 shadow-[0_1px_0_hsl(var(--border))] backdrop-blur lg:top-0 lg:mx-0 lg:flex lg:justify-between lg:px-0 lg:shadow-none">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground sm:text-xs">
          {saveState === 'saving' && (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>)}
          {saveState === 'saved' && (<><Check className="h-3.5 w-3.5 text-green-600" /> Saved</>)}
          {saveState === 'saved-local' && (<><Check className="h-3.5 w-3.5 text-green-600" /> Saved on this device</>)}
          {saveState === 'locked' && (<><Check className="h-3.5 w-3.5 text-green-600" /> Saved on this device — drafts locked</>)}
          {saveState === 'error' && (<span className="text-destructive">Save failed</span>)}
          {!canPublish && <span>{publicationValidationError}</span>}
        </span>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {pendingFinalize ? (
            <Button
              onClick={() => completeFinalization(pendingFinalize).catch(() => undefined)}
              disabled={publishStep === 4}
            >
              {publishStep === 4 ? (<><Loader2 className="h-4 w-4 animate-spin" /> Finalizing…</>) : 'Resume finalization'}
            </Button>
          ) : (
            <Button
              onClick={() => setIsConfirmOpen(true)}
              disabled={!canPublish || isEditingDisabled || isPollingRegistration}
              className="h-9 px-3 text-xs sm:h-10 sm:px-4 sm:text-sm"
            >
              Sign &amp; publish
            </Button>
          )}
          {currentDraftId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" disabled={isEditingDisabled || isPollingRegistration}>
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setIsDeleteConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <DeleteDraftDialog
        open={isDeleteConfirmOpen}
        draftTitle={draft?.title}
        errorMessage={error}
        isDeleting={isDeleting}
        onOpenChange={setIsDeleteConfirmOpen}
        onConfirm={handleDelete}
      />

      {draft?.publicationType === 'short' ? (
        <ShortEditor
          initialHtml={typeof initialContent === 'string' ? initialContent : ''}
          onChange={setContent}
          disabled={isEditingDisabled}
        />
      ) : (
        <Editor authors={authors}
                initialContent={initialContent}
                initialTitle={initialTitle}
                initialSubtitle={initialSubtitle}
                initialAuthorId={initialAuthorId}
                setContent={setContent}
                setTitle={setTitle}
                setSubtitle={setSubtitle}
                />
      )}

      <Dialog
        open={isConfirmOpen}
        onOpenChange={(open) => {
          setIsConfirmOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign &amp; publish</DialogTitle>
            <DialogDescription>
              {draft?.publicationType === 'short'
                ? 'A short is plain text up to 500 characters.'
                : 'An article needs a title and a body.'}{' '}
              Publishing permanently registers its human signature and can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="space-y-1 text-sm">
              <div className="font-medium text-base">
                {draft?.publicationType === 'short' ? 'Short' : draft?.title || 'Untitled article'}
              </div>
              {draft?.subtitle && <div className="text-muted-foreground">{draft.subtitle}</div>}
            </div>
            {!isAuthenticated ? (
              <p className="text-sm text-muted-foreground">
                Your draft is saved on this device. Sign in with World ID to publish it.
                It moves to your account automatically, and nothing you wrote is lost.
              </p>
            ) : selectedAuthor ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground truncate">
                  by <span className="font-medium text-foreground">{selectedAuthor.name}</span>
                  {' '}@{selectedAuthor.handle}
                </span>
              </div>
            ) : !areAuthorsLoaded ? (
              <p className="text-sm text-muted-foreground">Loading your author profile…</p>
            ) : authors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This account has no author profile yet, so it cannot publish.
              </p>
            ) : null}
            {isAuthenticated && draft?.publicationType === 'article' && (
              <div className="rounded-lg border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">Who can read it</span>
                  <div className="flex rounded-md border border-zinc-200 p-0.5 text-xs">
                    {(['public', 'gated'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={(draft?.access || 'public') === option}
                        onClick={() => setDraft((prev) => prev ? { ...prev, access: option } : prev)}
                        className={`rounded px-2.5 py-1 transition-colors ${
                          (draft?.access || 'public') === option
                            ? 'bg-foreground text-background'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {option === 'public' ? 'Anyone' : 'Verified humans'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {(draft?.access || 'public') === 'public'
                    ? 'Anyone can read the full text.'
                    : 'Everyone sees the title and opening lines. The rest opens for readers signed in with World ID, or for agents that pay over x402.'}
                </p>
              </div>
            )}
            {isAuthenticated && (
              isMiniKitInstalled === undefined ? (
                <p className="text-sm text-muted-foreground">Checking World wallet availability…</p>
              ) : canUseWorldWallet ? (
                <p className="text-sm text-muted-foreground">
                  After World ID verification, your World wallet will ask you to approve the on-chain registration.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Memorioso will sponsor and submit the on-chain registration for you.
                </p>
              )
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsConfirmOpen(false)}>Cancel</Button>
            {isAuthenticated ? (
              <Button onClick={handlePublish} disabled={!draft?.authorId}>
                Verify with World ID
              </Button>
            ) : (
              <Button onClick={handleSignInToPublish}>
                Sign in to publish
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
