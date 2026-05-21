'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FeedItem } from '@/components/FeedItem'
import {
  IDKitRequestWidget,
  CredentialRequest,
  any as anyCredential,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit'
import { useUserOperationReceipt } from '@worldcoin/minikit-react'
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
import { sendLibroRegistrationTransaction } from '@/lib/libro/client'
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
  const { status, signInWithWorldId } = useWorldIdAuth()
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

  useEffect(() => {
    const fetchAuthors = async () => {
      try {
        const raw = await fetch('/api/authors')
        const response = await raw.json()
        if (response.success) {
          setAuthors(response.authors)
        }
      } catch (error) {
        console.error('Failed to fetch authors:', error)
      }
    }

    fetchAuthors()
  }, [])

  const handleSave = async () => {
    try {
      let raw, response
      if (!draftId) {
        raw = await fetch(`/api/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draft),
        })
        response = await raw.json()
        if (response.success) {
          setDraft(response.draft)
          setOriginalDraft(response.draft)
          router.push(`/d/${response.draft.id}`)
          return response.draft
        }
      } else {
        raw = await fetch(`/api/draft/${draftId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draft),
        })
        response = await raw.json()
        if (response.success) {
          setOriginalDraft(draft) // Update original draft to the saved state
          return draft
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
      setError(null)
      setPublishStatus(null)
      setIsEditingDisabled(true)
      await handleSave()
      if (!draftId || !draft?.authorId) throw new Error('Draft ID or Author ID is missing')

      const raw = await fetch('/api/world-id/publish-context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ draftId }),
      })
      const response = await raw.json()

      if (response.success) {
        setPublishContext({
          challengeId: response.challengeId,
          appId: response.appId,
          action: response.action,
          environment: response.environment,
          rpContext: response.rpContext,
          signalText: response.signalText,
          signalHash: response.signalHash,
        })
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
      setIsEditingDisabled(false)
    }
  }

  const handleWorldIdResult = async (idkitResult: IDKitResult) => {
    if (!publishContext || !draftId) {
      throw new Error('Publish challenge is missing')
    }

    try {
      setPublishStatus('Preparing on-chain registration')
      const prepareRaw = await fetch(`/api/draft/${draftId}/publish/prepare`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          challengeId: publishContext.challengeId,
          idkitResult,
        }),
      })
      const prepareResponse = await prepareRaw.json() as PreparePublishResponse

      if (!prepareResponse.success) {
        throw new Error(prepareResponse.message || 'Failed to prepare on-chain registration')
      }

      setPublishStatus('Confirming sponsored registration in World App')
      const { userOpHash } = await sendLibroRegistrationTransaction(prepareResponse.transaction)

      setPublishStatus('Waiting for on-chain registration')
      const { transactionHash } = await pollUserOperationReceipt(userOpHash)

      setPublishStatus('Finalizing publication')
      const finalizeRaw = await fetch(`/api/draft/${draftId}/publish/finalize`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationId: prepareResponse.registrationId,
          userOpHash,
          transactionHash,
        }),
      })
      const finalizeResponse = await finalizeRaw.json() as FinalizePublishResponse

      if (!finalizeResponse.success) {
        throw new Error(finalizeResponse.message || 'Failed to finalize publication')
      }

      setPublishStatus(null)
      router.push(`/p/${finalizeResponse.publicationId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish'
      setError(message)
      setPublishStatus(null)
      setIsEditingDisabled(false)
      throw error
    }
  }

  const handleDelete = async () => {
    if (!draftId) return
    try {
      const raw = await fetch(`/api/draft?id=${draftId}`, {
        method: 'DELETE',
      })
      const response = await raw.json()
      if (response.success) {
        router.push('/drafts')
      }
    } catch (error) {
      console.error('Failed to delete draft:', error)
    }
  }

  const isDraftChanged = useCallback(() => {
    return JSON.stringify(draft) !== JSON.stringify(originalDraft)
  }, [draft, originalDraft])

  if (status === 'loading' || loading) {
    return <FeedItem item={null} />
  }

  const worldIdConstraints = publishContext
    ? anyCredential(
      CredentialRequest('proof_of_human', { signal: publishContext.signalText }),
      CredentialRequest('face', { signal: publishContext.signalText }),
      CredentialRequest('passport', { signal: publishContext.signalText }),
      CredentialRequest('mnc', { signal: publishContext.signalText })
    )
    : null

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
            setError(`World ID verification failed: ${errorCode}`)
            setIsEditingDisabled(false)
          }}
        />
      )}
      {error && <AlertDestructive message={error} />}
      {publishStatus && (
        <Alert>
          <AlertTitle>Publishing</AlertTitle>
          <AlertDescription>{publishStatus}</AlertDescription>
        </Alert>
      )}

      <div className="flex space-x-2">
        <Button onClick={handleSave} disabled={!isDraftChanged() || isEditingDisabled || isPollingRegistration}>Save</Button>
        {draftId && <Button onClick={handleDelete} variant="destructive" disabled={isEditingDisabled || isPollingRegistration}>Delete</Button>}
        {draftId && (
          <Button 
            onClick={handlePublish} 
            disabled={!draft?.authorId || isEditingDisabled || isPollingRegistration}
          >
            Publish
          </Button>
        )}
      </div>
      <Editor authors={authors}
              initialContent={initialContent}
              initialTitle={initialTitle}
              initialSubtitle={initialSubtitle}
              initialAuthorId={initialAuthorId}
              setContent={setContent}
              setTitle={setTitle}
              setSubtitle={setSubtitle}
              setAuthorId={setAuthorId}
              />
    </div>
  )
}
