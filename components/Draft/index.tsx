'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { MoreVertical, Trash2, Check, Loader2 } from 'lucide-react'
import { FeedItem } from '@/components/FeedItem'
import {
  IDKitRequestWidget,
  CredentialRequest,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit'
import { useUserOperationReceipt } from '@worldcoin/minikit-react'
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider'
import { createPublicClient, http } from 'viem'
import { worldchain } from 'viem/chains'
import { type Author } from '@/types'
import Editor from '@/components/Editor'
import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { type PublicationContent } from '@/types'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
import {
  isNativeLibroTransactionAvailable,
  sendLibroRegistrationTransaction,
} from '@/lib/libro/client'
import type { LibroRegistrationTransaction } from '@/lib/libro/proof'

type DraftData = {
  id?: string
  status?: string
  title: string
  subtitle: string
  content: PublicationContent
  authorId?: string
  history?: unknown
}

type PublishContext = {
  challengeId: string
  appId: `app_${string}`
  action: string
  environment: 'production' | 'staging'
  rpContext: RpContext
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

type FinalizePublishResponse =
  | {
      success: true
      publicationId: string
    }
  | {
      success: false
      message?: string
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

export const Draft = ({ draftId }: { draftId: string | null }) => {
  const [draft, setDraft] = useState<DraftData | null>({ title: '', subtitle: '', content: { html: '' } })
  const [originalDraft, setOriginalDraft] = useState<DraftData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditingDisabled, setIsEditingDisabled] = useState<boolean>(false)
  const router = useRouter()
  const [authors, setAuthors] = useState<Author[]>([])
  const [initialContent, setInitialContent] = useState<Object | null>(null)
  const [initialTitle, setInitialTitle] = useState<string>('')
  const [initialSubtitle, setInitialSubtitle] = useState<string>('')
  const [initialAuthorId, setInitialAuthorId] = useState<string | null>(null)
  const [publishContext, setPublishContext] = useState<PublishContext | null>(null)
  const [isWorldIdOpen, setIsWorldIdOpen] = useState(false)
  const [publishStatus, setPublishStatus] = useState<string | null>(null)
  const [publishStep, setPublishStep] = useState<number | null>(null)
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isPickingAuthor, setIsPickingAuthor] = useState(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishHostVerifyError = useRef<string | null>(null)
  const { status, signInWithWorldId } = useWorldIdAuth()
  const { isInstalled: isMiniKitInstalled } = useMiniKit()
  const canUseWorldWallet = isMiniKitInstalled === true && isNativeLibroTransactionAvailable()
  const publicClient = useMemo(() => createPublicClient({
    chain: worldchain,
    transport: http(process.env.NEXT_PUBLIC_LIBRO_RPC_URL || 'https://worldchain-mainnet.g.alchemy.com/public'),
  }), [])
  const { poll: pollUserOperationReceipt, isLoading: isPollingRegistration } = useUserOperationReceipt({
    client: publicClient,
  })

  useEffect(() => {
    if (status === 'unauthenticated') {
      signInWithWorldId().catch(() => setError('Failed to sign in'))
    }
  }, [status, signInWithWorldId])

  useEffect(() => {
    setCurrentDraftId(draftId)
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

  const setAuthorId = (authorId: string | null) => {
    setDraft((prevDraft) => prevDraft ? { ...prevDraft, authorId } as DraftData : null)
  }

  useEffect(() => {
    const fetchDraft = async () => {
      if (draftId) {
        try {
          const raw = await fetch(`/api/draft/${draftId}`)
          const response = await raw.json()
          if (response.success) {
            setDraft(response.data)
            setOriginalDraft(response.data)
            setInitialContent(response.data.content.html)
            setInitialTitle(response.data.title || '')
            setInitialSubtitle(response.data.subtitle || '')
            setInitialAuthorId(response.data.authorId)
          } else {
            router.push('/')
          }
        } catch (error) {
          console.error('Failed to fetch draft:', error)
          router.push('/')
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }

    fetchDraft()
  }, [draftId, router])

  const fetchAuthors = useCallback(async () => {
    try {
      const raw = await fetch('/api/authors')
      const response = await raw.json()
      if (response.success) {
        setAuthors(response.authors)
      }
    } catch (error) {
      console.error('Failed to fetch authors:', error)
    }
  }, [])

  useEffect(() => {
    fetchAuthors()
  }, [fetchAuthors])

  // Auto-assign the author when the writer has exactly one identity.
  useEffect(() => {
    if (authors.length === 1) {
      setDraft((prev) => (prev && !prev.authorId ? { ...prev, authorId: authors[0].id } : prev))
    }
  }, [authors])

  const handleSave = async () => {
    try {
      let raw: Response, response: any
      const draftToSave = draft
      if (!currentDraftId) {
        raw = await fetch(`/api/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draftToSave),
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
          return savedDraft
        }
      } else {
        raw = await fetch(`/api/draft/${currentDraftId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draftToSave),
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

      const raw = await fetch('/api/world-id/publish-context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draftId: publishDraftId }),
      })
      const response = await raw.json()

      if (response.success) {
        const nextPublishContext: PublishContext = {
          challengeId: response.challengeId,
          appId: response.appId,
          action: response.action,
          environment: response.environment,
          rpContext: response.rpContext,
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

  const handleWorldIdResult = async (idkitResult: IDKitResult) => {
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

      setPublishStep(4)
      setPublishStatus('Finalizing publication')
      const finalizeRaw = await fetch(`/api/draft/${currentDraftId}/publish/finalize`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId: prepareResponse.registrationId,
          submissionMethod,
          userOpHash,
          transactionHash,
        }),
      })
      const finalizeResponse = await finalizeRaw.json() as FinalizePublishResponse

      if (!finalizeResponse.success) {
        throw new Error(finalizeResponse.message || 'Failed to finalize publication')
      }

      setPublishStatus(null)
      publishHostVerifyError.current = null
      router.push(`/p/${finalizeResponse.publicationId}?signed=1`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish'
      publishHostVerifyError.current = message
      setError(message)
      setPublishStatus(null)
      setPublishStep(null)
      setIsEditingDisabled(false)
      throw error
    }
  }

  const handleDelete = async () => {
    if (!currentDraftId) return
    try {
      const raw = await fetch(`/api/draft?id=${currentDraftId}`, {
        method: 'DELETE',
      })
      const response = await raw.json()
      if (response.success) {
        router.push('/')
      }
    } catch (error) {
      console.error('Failed to delete draft:', error)
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
    (draft?.content?.html || '').replace(/<[^>]*>/g, '').trim().length > 0

  // Debounced autosave: no Save button, work is never lost.
  useEffect(() => {
    if (isEditingDisabled || !isDraftChanged()) return
    if (!hasText) return

    setSaveState('saving')
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      try {
        await handleSaveRef.current()
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 1200)

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [draft, isEditingDisabled, isDraftChanged, hasText])

  if (status === 'loading' || loading) {
    return <FeedItem item={null} />
  }

  const worldIdConstraints = publishContext
    ? CredentialRequest('proof_of_human', { signal: publishContext.signalText })
    : null

  const selectedAuthor = authors.find((a) => a.id === draft?.authorId) || null

  return (
    <div className="w-[90%] mx-auto space-y-4 py-4">
      {publishContext && worldIdConstraints && (
        <IDKitRequestWidget
          open={isWorldIdOpen}
          onOpenChange={(open) => {
            setIsWorldIdOpen(open)
            if (!open && !publishStatus) {
              setIsEditingDisabled(false)
            }
          }}
          app_id={publishContext.appId}
          action={publishContext.action}
          rp_context={publishContext.rpContext}
          allow_legacy_proofs={false}
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
            setIsEditingDisabled(false)
          }}
        />
      )}
      {error && <AlertDestructive message={error} />}
      {publishStep !== null && (
        <PublishProgress step={publishStep} status={publishStatus} />
      )}
      <div className="sticky top-14 z-20 -mx-[5vw] px-[5vw] py-2 bg-background/95 backdrop-blur border-b flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {saveState === 'saving' && (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>)}
          {saveState === 'saved' && (<><Check className="h-3.5 w-3.5 text-green-600" /> Saved</>)}
          {saveState === 'error' && (<span className="text-destructive">Save failed</span>)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsConfirmOpen(true)}
            disabled={!hasText || isEditingDisabled || isPollingRegistration}
          >
            Sign &amp; publish
          </Button>
          {currentDraftId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" disabled={isEditingDisabled || isPollingRegistration}>
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Delete draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Editor authors={authors}
              initialContent={initialContent}
              initialTitle={initialTitle}
              initialSubtitle={initialSubtitle}
              initialAuthorId={initialAuthorId}
              setContent={setContent}
              setTitle={setTitle}
              setSubtitle={setSubtitle}
              />

      <Sheet
        open={isConfirmOpen}
        onOpenChange={(open) => {
          setIsConfirmOpen(open)
          if (!open) {
            setIsPickingAuthor(false)
          }
        }}
      >
        <SheetContent side="bottom" className="rounded-t-xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Sign &amp; publish</SheetTitle>
            <SheetDescription>
              This permanently registers proof that a human authored this text. It can&apos;t be undone.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-3">
            <div className="space-y-1 text-sm">
              <div className="font-medium text-base">{draft?.title || 'Untitled'}</div>
              {draft?.subtitle && <div className="text-muted-foreground">{draft.subtitle}</div>}
            </div>
            {selectedAuthor && !isPickingAuthor ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground truncate">
                  by <span className="font-medium text-foreground">{selectedAuthor.name}</span>
                  {' '}@{selectedAuthor.handle}
                </span>
                {authors.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setIsPickingAuthor(true)}>
                    Change
                  </Button>
                )}
              </div>
            ) : authors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This account has no author profile yet, so it cannot publish.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Publish as</p>
                <div className="flex flex-wrap gap-2">
                  {authors.map((a) => (
                    <Button
                      key={a.id}
                      variant={a.id === draft?.authorId ? 'default' : 'outline'}
                      className="rounded-full h-10"
                      onClick={() => {
                        setAuthorId(a.id)
                        setIsPickingAuthor(false)
                      }}
                    >
                      {a.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {isMiniKitInstalled === undefined ? (
              <p className="text-sm text-muted-foreground">Checking World wallet availability…</p>
            ) : canUseWorldWallet ? (
              <p className="text-sm text-muted-foreground">
                After World ID verification, your World wallet will ask you to approve the on-chain registration.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Memorioso will sponsor and submit the on-chain registration for you.
              </p>
            )}
          </div>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setIsConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handlePublish} disabled={!draft?.authorId}>
              Verify with World ID
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
