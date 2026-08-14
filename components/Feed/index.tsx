'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { useRouter } from 'next/navigation'

import type { FeedItemD } from '@/components/FeedItem'
import { FeedItem } from '@/components/FeedItem'

type FeedStatus = 'loading' | 'ready'

export const Feed = () => {
  const [feedStatus, setFeedStatus] = useState<FeedStatus>('loading')
  const [feedItems, setFeedItems] = useState<FeedItemD[]>([])
  const router = useRouter()
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        const raw = await fetch('/api/drafts');
        const response = await raw.json();
        if(response.success) {
          const drafts = response.drafts;
          setFeedItems(drafts.slice(0, 5))
          setFeedStatus('ready')
        }
      } catch (error) {
        console.error('Failed to fetch drafts:', error)
      }
    };

    fetchData();
  }, []);

  const EmptyFeed = () => (
    <div className="py-6 text-center">
      <p className="text-muted-foreground mb-4">You have no drafts yet.</p>
      <Button onClick={() => router.push('/d/new')}>
        Start writing
      </Button>
    </div>
  )

  const FeedContent = () => (
    <div className="space-y-3">
      {feedItems && feedItems.length > 0 ? (
        feedItems.map((item) => (
          <FeedItem key={item.id} item={item} />
        ))
      ) : (
        <EmptyFeed />
      )}
    </div>
  )

  const FeedLoading = () => (
    <div className="space-y-3">
      <FeedItem item={null} />
      <FeedItem item={null} />
    </div>
  )

  // Width and section spacing come from the surrounding page container.
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your Drafts
        </h2>
        <Link href="/activity" className="text-xs text-blurple hover:underline">
          View activity
        </Link>
      </div>
      {feedStatus === 'loading' && <FeedLoading />}
      {feedStatus === 'ready' && <FeedContent />}
    </div>
  )
}
