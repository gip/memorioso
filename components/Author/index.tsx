'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type Author as AuthorType, type PublicationInfo } from '@/lib/db/objects'
import Link from 'next/link'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'
import { AgentRegistrationPanel } from './AgentRegistrationPanel'

export const Author = ({ create, author, publicationInfos, redirect = null }: { create: boolean, author: AuthorType | null, publicationInfos: PublicationInfo[], redirect?: string | null }) => {
  const { status, signInWithWallet } = useWorldIdAuth()
  const [newAuthor, setNewAuthor] = useState<Omit<AuthorType, 'id'>>({
    name: '',
    bio: '',
    handle: ''
  })
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (create && status === 'unauthenticated') {
      signInWithWallet().catch(() => setError('Failed to sign in'))
    }
  }, [create, status, signInWithWallet])

  useEffect(() => {
    if (redirect) {
      router.replace(redirect)
    }
  }, [redirect, router])

  const handleSave = async () => {
    try {
      const raw = await fetch(`/api/author`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newAuthor),
      })
      const response = await raw.json()
      if (response.success && response.author?.id) {
        router.replace(`/a/${response.author.id}`)
      }
    } catch (error) {
      console.error('Failed to save author:', error)
      setError('Failed to save author')
    }
  }

  if (author) {
    return (<>
      <div className="w-[90%] mx-auto">
        <div className="text-xs italic text-center text-gray-500">This author was created by a human on Memorioso. Every publication under this author is signed by a human being.<br />This is not a bot.</div>
      </div>
      <div className="w-[90%] mx-auto space-y-8 py-8">
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
        </div>
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
                  <span className="italic underline hover:text-blue-500">{publicationInfo.publication_title}</span>
                  <br />
                  <span className="text-xs">{new Date(publicationInfo.publication_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
        <AgentRegistrationPanel authorId={author.id} />
      </div>
    </>)
  }

  if (create && status === 'authenticated') {
    const isNameValid = newAuthor.name.length >= 3 && newAuthor.name.length <= 100
    const isHandleValid = (newAuthor.handle || '').length >= 3 && (newAuthor.handle || '').length <= 32
    const isValid = isNameValid && isHandleValid

    return (
      <div className="w-[90%] mx-auto space-y-4 py-4">
        {error && <div className="text-red-500">{error}</div>}
        <div className="flex flex-col gap-1">
          <Input
            value={newAuthor.name}
            onChange={(e) => {
              const name = e.target.value
              if (name.length <= 100) {
                setNewAuthor(prev => ({ ...prev, name }))
              }
            }}
            placeholder="Name"
            className="w-full"
          />
          <span className="text-xs text-gray-500 italic">Name must be 3-100 characters</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-gray-500">@</span>
            <Input
              value={newAuthor.handle}
              onChange={(e) => {
                const handle = e.target.value.replace(/[^a-zA-Z0-9\-_]/g, '')
                if (handle.length <= 32) {
                  setNewAuthor(prev => ({ ...prev, handle }))
                }
              }}
              placeholder="Handle"
              className="w-full"
            />
          </div>
          <span className="text-xs text-gray-500 italic">Handle must be 3-32 characters and can only contain letters, numbers, hyphens and underscores</span>
        </div>
        <div className="flex flex-col gap-1">
          <Textarea
            value={newAuthor.bio || ''}
            onChange={(e) => setNewAuthor(prev => ({ ...prev, bio: e.target.value }))}
            placeholder="Bio"
            className="w-full"
          />
          <span className="text-xs text-gray-500 italic">Bio is optional and can be updated later</span>
        </div>
        <div className="flex space-x-2">
          <Button onClick={handleSave} disabled={!isValid}>Create Author</Button>
        </div>
      </div>
    )
  }

  return <div className="w-[90%] mx-auto space-y-4 py-4">Author not found</div>
}
