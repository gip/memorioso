'use client'

import { useEffect, useState } from 'react'
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
          setFeedItems(drafts)
          setFeedStatus('ready')
        }
      } catch (error) {
        console.error('Failed to fetch drafts:', error)
      }
    };

    fetchData();
  }, []);

  const EmptyFeed = () => (
    <div className="w-[90%] mx-auto py-8 text-center">
      <h3 className="text-xl font-semibold mb-2">No drafts yet</h3>
      <p className="text-muted-foreground mb-4">Start writing your first draft to get started</p>
      <Button onClick={() => router.push('/d/new')}>
        Create New Draft
      </Button>
    </div>
  )

  const FeedContent = () => (
    <div className="w-[90%] mx-auto space-y-2 py-4">
      {feedItems && feedItems.length > 0 ? (
        <>
          {feedItems.map((item) => (
            <FeedItem key={item.id} item={item} />
          ))}
          <div className="text-center pt-8">
            <Button onClick={() => router.push('/d/new')}>
              Create New Draft
            </Button>
          </div>
        </>
      ) : (
        <EmptyFeed />
      )}
    </div>
  )

  const FeedLoading = () => (
    <div className="w-[90%] mx-auto space-y-2 py-4">
      <FeedItem item={null} />
      <FeedItem item={null} />
    </div>
  )

  return (
    <>      
      <div className="w-[90%] mx-auto">
        <main className="w-full">
          <div className="text-left p-4 flex items-start gap-2">
            <h2 className="text-2xl font-bold">Your Drafts</h2>
            {/* <Link href="/d/new" className="hover:bg-gray-300 bg-gray-200 p-1 rounded-md mt-1">
              <Plus size={10} />
            </Link> */}
          </div>
          {feedStatus === 'loading' &&
              <FeedLoading />}
          {feedStatus === 'ready' &&
            <FeedContent />}
        </main>
      </div>
    </>
  )
}
