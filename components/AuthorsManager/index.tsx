'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ExternalLink, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Author } from '@/types'

const MAX_AUTHORS = 5

type ManagedAuthor = Author & { isPrimary: boolean }
type HandleStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error'

export const AuthorsManager = () => {
  const [authors, setAuthors] = useState<ManagedAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [handleStatus, setHandleStatus] = useState<HandleStatus>('idle')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [saving, setSaving] = useState(false)

  const loadAuthors = useCallback(async () => {
    try {
      const raw = await fetch('/api/authors', { cache: 'no-store' })
      const response = await raw.json()
      if (!raw.ok || !response.success) throw new Error(response.message || 'Failed to load authors')
      setAuthors(response.authors)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load authors')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAuthors()
  }, [loadAuthors])

  useEffect(() => {
    const normalized = handle.trim().toLowerCase()
    if (!normalized) {
      setHandleStatus('idle')
      return
    }
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) {
      setHandleStatus('invalid')
      return
    }
    setHandleStatus('checking')
    const timer = window.setTimeout(async () => {
      try {
        const raw = await fetch(`/api/auth/handle?handle=${encodeURIComponent(normalized)}`)
        const response = await raw.json()
        setHandleStatus(response.valid && !response.exists ? 'available' : response.valid ? 'taken' : 'invalid')
      } catch {
        setHandleStatus('error')
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [handle])

  const resetCreate = () => {
    setHandle('')
    setName('')
    setBio('')
    setHandleStatus('idle')
    setError(null)
  }

  const createAuthor = async () => {
    setCreating(true)
    setError(null)
    try {
      const raw = await fetch('/api/authors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, name, bio }),
      })
      const response = await raw.json()
      if (!raw.ok || !response.success) throw new Error(response.message || 'Failed to create author')
      setAuthors((current) => [...current, response.author])
      setCreateOpen(false)
      resetCreate()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to create author')
    } finally {
      setCreating(false)
    }
  }

  const startEditing = (author: ManagedAuthor) => {
    setEditingId(author.id)
    setEditName(author.name)
    setEditBio(author.bio || '')
    setError(null)
  }

  const saveAuthor = async (authorId: string) => {
    setSaving(true)
    setError(null)
    try {
      const raw = await fetch(`/api/author/${authorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, bio: editBio }),
      })
      const response = await raw.json()
      if (!raw.ok || !response.success) throw new Error(response.message || 'Failed to save author')
      setAuthors((current) => current.map((author) => (
        author.id === authorId ? { ...author, ...response.author } : author
      )))
      setEditingId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save author')
    } finally {
      setSaving(false)
    }
  }

  const canCreate = authors.length < MAX_AUTHORS
  const createValid = handleStatus === 'available'
    && name.trim().length >= 3
    && name.trim().length <= 100
    && bio.trim().length <= 2000

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My authors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One World ID account can publish under up to {MAX_AUTHORS} author profiles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!canCreate || loading}>
          <Plus className="h-4 w-4" /> Add author
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{authors.length} of {MAX_AUTHORS} profiles used</p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading authors…</div>
      ) : (
        <div className="space-y-3">
          {authors.map((author) => (
            <div key={author.id} className="rounded-lg border p-4">
              {editingId === author.id ? (
                <div className="space-y-3">
                  <Input value={editName} onChange={(event) => setEditName(event.target.value.slice(0, 100))} aria-label="Author name" />
                  <Textarea value={editBio} onChange={(event) => setEditBio(event.target.value.slice(0, 2000))} placeholder="Bio (optional)" aria-label="Author bio" />
                  <p className="text-xs text-muted-foreground">Handle: @{author.handle} · handles cannot be changed</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
                    <Button onClick={() => saveAuthor(author.id)} disabled={saving || editName.trim().length < 3}>
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{author.name}</span>
                      {author.isPrimary && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Primary</span>}
                    </div>
                    <p className="text-sm text-blurple">@{author.handle}</p>
                    {author.bio && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{author.bio}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/@${author.handle}`}>View <ExternalLink className="h-3.5 w-3.5" /></Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => startEditing(author)}>Edit</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!canCreate && <p className="text-sm text-muted-foreground">You have reached the five-author limit.</p>}

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreate() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an author</DialogTitle>
            <DialogDescription>Create another pen name controlled by this World ID account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Input value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} placeholder="handle" aria-label="Author handle" />
              <p className={`mt-1 text-xs ${handleStatus === 'taken' || handleStatus === 'invalid' || handleStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {handleStatus === 'checking' && 'Checking availability…'}
                {handleStatus === 'available' && <><Check className="mr-1 inline h-3 w-3" />Handle is available</>}
                {handleStatus === 'taken' && 'That handle is already taken'}
                {handleStatus === 'invalid' && 'Use 3–32 lowercase letters, numbers, underscores, or hyphens'}
                {handleStatus === 'error' && 'Could not check availability'}
                {handleStatus === 'idle' && 'This becomes the permanent public handle'}
              </p>
            </div>
            <Input value={name} onChange={(event) => setName(event.target.value.slice(0, 100))} placeholder="Display name" aria-label="Display name" />
            <Textarea value={bio} onChange={(event) => setBio(event.target.value.slice(0, 2000))} placeholder="Bio (optional)" aria-label="Bio" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createAuthor} disabled={!createValid || creating}>{creating ? 'Creating…' : 'Create author'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
