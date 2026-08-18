'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Link2 } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type Author as AuthorType, type AuthorPublicationCounts } from '@/lib/db/objects'
import { AgentRegistrationPanel } from './AgentRegistrationPanel'
import { AuthorPublications } from '@/components/AuthorPublications'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export const Author = ({ author, counts, redirect = null, self = false }: { author: AuthorType | null, counts: AuthorPublicationCounts, redirect?: string | null, self?: boolean }) => {
  const router = useRouter()
  const { status } = useWorldIdAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(author?.name || '')
  const [editBio, setEditBio] = useState(author?.bio || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const canEdit = self && status === 'authenticated'
  const profileUrl = author ? `${process.env.NEXT_PUBLIC_APP_URL}/@${author.handle}` : ''

  useEffect(() => {
    if (redirect) {
      router.replace(redirect)
    }
  }, [redirect, router])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const startEditing = () => {
    setEditName(author?.name || '')
    setEditBio(author?.bio || '')
    setError(null)
    setIsEditing(true)
  }

  const copyProfileUrl = async () => {
    if (!profileUrl) return
    try {
      await navigator.clipboard.writeText(profileUrl)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      // No clipboard access (insecure origin, denied permission). Fall back to
      // showing the URL so the reader can still select and copy it by hand.
      setCopyFailed(true)
    }
  }

  const handleSave = async () => {
    if (!author) return
    setIsSaving(true)
    setError(null)
    try {
      const raw = await fetch(`/api/author/${author.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: editName.trim(), bio: editBio.trim() }),
      })
      const response = await raw.json()
      if (!raw.ok || !response.success) {
        setError(response.message || 'Failed to save profile')
        return
      }
      setIsEditing(false)
      router.refresh()
    } catch (error) {
      console.error('Failed to save author:', error)
      setError('Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  if (author) {
    const isNameValid = editName.trim().length >= 3 && editName.trim().length <= 100
    return (
      <div className="space-y-8 py-8">
        {canEdit && isEditing ? (
          <div className="mx-auto max-w-md space-y-4">
            <h1 className="text-lg font-semibold tracking-tight">Edit profile</h1>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <div className="flex flex-col gap-1">
              <Input
                value={editName}
                onChange={(e) => {
                  if (e.target.value.length <= 100) {
                    setEditName(e.target.value)
                  }
                }}
                placeholder="Name"
                aria-label="Display name"
              />
              <span className="text-xs text-muted-foreground">Name must be 3-100 characters</span>
            </div>
            <div className="flex flex-col gap-1">
              <Textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value.slice(0, 2000))}
                placeholder="Bio"
                aria-label="Bio"
              />
              <span className="text-xs text-muted-foreground">Bio is optional</span>
            </div>
            <p className="text-sm text-muted-foreground">
              @{author.handle} <span className="text-xs">· fixed at signup</span>
            </p>
            <div className="flex space-x-2">
              <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSave} disabled={!isNameValid || isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <header className="space-y-4 border-b pb-8 text-center">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">{author.name}</h1>
              <p className="text-sm text-blurple">@{author.handle}</p>
            </div>
            {author.bio && (
              <p className="mx-auto max-w-prose text-sm leading-relaxed text-muted-foreground">{author.bio}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={copyProfileUrl}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {copied ? 'Link copied' : 'Copy link'}
              </Button>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={startEditing}>Edit profile</Button>
              )}
            </div>
            {copyFailed && (
              <p className="mx-auto max-w-full break-all text-xs text-muted-foreground">{profileUrl}</p>
            )}
            <p className="mx-auto max-w-prose text-xs leading-relaxed text-muted-foreground">
              Human-controlled identity. Each publication is labeled as direct human work or
              human-authorized agent work.{' '}
              <Link href="/how-it-works" className="text-blurple underline-offset-2 hover:underline">
                How it works
              </Link>
            </p>
          </header>
        )}
        <AuthorPublications authorId={author.id} counts={counts} />
        <AgentRegistrationPanel authorId={author.id} />
      </div>
    )
  }

  return <div className="space-y-4 py-4">Author not found</div>
}
