'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type Author as AuthorType, type PublicationInfo } from '@/lib/db/objects'
import Link from 'next/link'
import { AgentRegistrationPanel } from './AgentRegistrationPanel'
import { PublicationTimestamp } from '@/components/PublicationTimestamp'

export const Author = ({ author, publicationInfos, redirect = null, self = false }: { author: AuthorType | null, publicationInfos: PublicationInfo[], redirect?: string | null, self?: boolean }) => {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(author?.name || '')
  const [editBio, setEditBio] = useState(author?.bio || '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        {isEditing ? (
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
              <a href={`${process.env.NEXT_PUBLIC_APP_URL}/a/${author.handle}`} className="text-sm text-blurple hover:underline">
                {`@${author.handle}`}
              </a>
            </div>
            <div className="text-xm">
              <span className="text-xs">Link: </span>
              <span className="text-xm text-blurple">
                <a href={`${process.env.NEXT_PUBLIC_APP_URL}/a/${author.handle}`} className="text-sm text-burple hover:underline">
                  {`${process.env.NEXT_PUBLIC_APP_URL}/a/${author.handle}`}
                </a></span>
            </div>
            {self && (
              <div>
                <Button variant="outline" size="sm" onClick={startEditing}>Edit profile</Button>
              </div>
            )}
          </div>
        )}
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {publicationInfos.length === 0 && "This author has not published yet"}
            {publicationInfos.length > 0 && publicationInfos.length <= 20 &&
              `This author has ${publicationInfos.length} publication${publicationInfos.length !== 1 ? 's:' : '.'}`
            }
            {publicationInfos.length > 20 && "This author has 20+ publications:"}
          </div>
        </div>
        <div className="space-y-4">
          {publicationInfos.slice(0, 20).map(publicationInfo => (
            <Link href={`/p/${publicationInfo.id}`} key={publicationInfo.id}>
              <div className="flex items-center gap-2">
                <span>
                  {publicationInfo.publication_title.trim() ? (
                    <span className="line-clamp-2 italic underline hover:text-blue-500">
                      {publicationInfo.publication_title}
                    </span>
                  ) : (
                    <span className="line-clamp-2 text-sm font-normal leading-snug hover:text-blue-500">
                      {publicationInfo.publication_excerpt}
                    </span>
                  )}
                  <br />
                  <span className="text-xs text-blurple">{publicationInfo.authorship_label}</span>
                  <br />
                  <PublicationTimestamp
                    className="text-xs"
                    date={publicationInfo.publication_date}
                    style="short"
                  />
                </span>
              </div>
            </Link>
          ))}
        </div>
        <AgentRegistrationPanel authorId={author.id} />
      </div>
    </>)
  }

  return <div className="space-y-4 py-4">Author not found</div>
}
