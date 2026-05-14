'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState, useCallback } from 'react'
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
import { type Author } from '@/types'
import Editor from '@/components/Editor'
import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { type ContentOrHtml } from '@/types'
import { signInWithWorldWallet } from '@/lib/world-id/client-auth'

type DraftData = {
  id?: string
  status?: string
  title: string
  subtitle: string
  content: ContentOrHtml
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
  const { data: session, status } = useSession()
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

  useEffect(() => {
    if (status === 'unauthenticated') {
      signInWithWorldWallet().catch(() => setError('Failed to sign in'))
    }
  }, [status])

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

    const raw = await fetch(`/api/draft/${draftId}/publish`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        challengeId: publishContext.challengeId,
        idkitResult,
      }),
    })
    const response = await raw.json()

    if (!response.success) {
      throw new Error(response.message || 'Failed to publish')
    }

    router.push(`/p/${response.publicationId}`)
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
            if (!open) {
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

      <div className="flex space-x-2">
        <Button onClick={handleSave} disabled={!isDraftChanged() || isEditingDisabled}>Save</Button>
        {draftId && <Button onClick={handleDelete} variant="destructive" disabled={isEditingDisabled}>Delete</Button>}
        {draftId && (
          <Button 
            onClick={handlePublish} 
            disabled={!draft?.authorId || isEditingDisabled}
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
