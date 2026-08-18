'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const canEdit = self && status === 'authenticated'

  useEffect(() => {
    if (redirect) {
      router.replace(redirect)
    }
  }, [redirect, router])

  const startEditing = () => {
    setEditName(author?.name || '')
    setEditBio(author?.bio || '')
    setError(null)
    setIsEditing(true)
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
    return (<>
      <div className="pt-4">
        <div className="text-xs italic text-center text-gray-500">This author was created by a human on Memorioso. Publications are labeled as direct human work or human-authorized agent work.<br />The author identity itself is human-controlled.</div>
      </div>
      <div className="space-y-8 py-8">
        {canEdit && isEditing ? (
          <div className="space-y-4 max-w-md mx-auto">
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
              />
              <span className="text-xs text-gray-500 italic">Name must be 3-100 characters</span>
            </div>
            <div className="flex flex-col gap-1">
              <Textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value.slice(0, 2000))}
                placeholder="Bio"
              />
              <span className="text-xs text-gray-500 italic">Bio is optional</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Handle: @{author.handle} <span className="text-xs italic">(fixed at signup)</span>
            </div>
            <div className="flex space-x-2">
              <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>Cancel</Button>
              <Button onClick={handleSave} disabled={!isNameValid || isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div>
              <span className="text-xs">Author: </span>
              <span className="text-3xl">{author.name}</span>
            </div>
            <div>
              <span className="text-xs">Bio: </span>
              <span className="text-md">{author.bio}</span>
            </div>
            <div className="text-xm">
              <span className="text-xs">Handle: </span>
              <a href={`${process.env.NEXT_PUBLIC_APP_URL}/@${author.handle}`} className="text-sm text-blurple hover:underline">
                {`@${author.handle}`}
              </a>
            </div>
            <div className="text-xm">
              <span className="text-xs">Link: </span>
              <span className="text-xm text-blurple">
                <a href={`${process.env.NEXT_PUBLIC_APP_URL}/@${author.handle}`} className="text-sm text-burple hover:underline">
                  {`${process.env.NEXT_PUBLIC_APP_URL}/@${author.handle}`}
                </a></span>
            </div>
            {canEdit && (
              <div>
                <Button variant="outline" size="sm" onClick={startEditing}>Edit profile</Button>
              </div>
            )}
          </div>
        )}
        <AuthorPublications authorId={author.id} counts={counts} />
        <AgentRegistrationPanel authorId={author.id} />
      </div>
    </>)
  }

  return <div className="space-y-4 py-4">Author not found</div>
}
