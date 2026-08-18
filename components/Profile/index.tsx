'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Author } from '@/types'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

type ManagedAuthor = Author & { isPrimary: boolean }

export const Profile = ({ subject }: { subject: string }) => {
  const [author, setAuthor] = useState<ManagedAuthor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const { signOut, signInWithWorldId } = useWorldIdAuth()

  const loadAuthor = useCallback(async () => {
    try {
      const raw = await fetch('/api/authors', { cache: 'no-store' })
      const response = await raw.json()
      if (!raw.ok || !response.success) throw new Error(response.message || 'Failed to load author')
      const next = response.authors[0] ?? null
      setAuthor(next)
      setName(next?.name ?? '')
      setBio(next?.bio ?? '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load author')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAuthor() }, [loadAuthor])

  const saveAuthor = async () => {
    if (!author) return
    setSaving(true)
    setError(null)
    try {
      const raw = await fetch(`/api/author/${author.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio }),
      })
      const response = await raw.json()
      if (!raw.ok || !response.success) throw new Error(response.message || 'Failed to save author')
      setAuthor((current) => current ? { ...current, ...response.author } : current)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save author')
    } finally {
      setSaving(false)
    }
  }

  const createAnotherHandle = async () => {
    await signOut()
    await signInWithWorldId()
  }

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This login controls exactly one permanent handle. Your display name and bio remain editable.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading author…
        </div>
      ) : author ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-blurple">@{author.handle}</p>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/@${author.handle}`}>View <ExternalLink className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
          <Input value={name} onChange={(event) => setName(event.target.value.slice(0, 100))} aria-label="Display name" />
          <Textarea value={bio} onChange={(event) => setBio(event.target.value.slice(0, 2000))} placeholder="Bio (optional)" aria-label="Bio" />
          <Button onClick={saveAuthor} disabled={saving || name.trim().length < 3}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-destructive">This login has no author profile.</p>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Use another handle</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This signs out and creates a fresh, unlinkable World ID session. It does not add a second handle to this login.
        </p>
        <Button className="mt-3" variant="outline" onClick={createAnotherHandle}>Create another handle</Button>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">World ID</h2>
        <p className="mt-2 break-all rounded-lg bg-gray-100 px-3 py-2 text-center text-xs">
          {subject}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This unique ID is the only information we store about you. It is application-specific and
          cannot be traced.
        </p>
      </div>
    </div>
  )
}
