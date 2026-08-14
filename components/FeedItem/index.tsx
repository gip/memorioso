import { Skeleton } from "@/components/ui/skeleton"
import { TextListCard } from '@/components/TextListCard'
import { extractReadableText } from '@libro/core'

export type FeedItemD = {
    id: string;
    title: string;
    subtitle?: string;
    content: { html: string };
    created_at?: string;
    updated_at?: string;
    author_name?: string;
    publicationType?: 'short' | 'article';
}

const FeedItemLoading = () => (
  <div className="rounded-xl border bg-card px-4 py-3.5 shadow-sm">
    <Skeleton className="h-4 w-[250px]" />
    <Skeleton className="mt-2 h-3 w-[120px]" />
  </div>
)

export const FeedItem = ({ item }: { item: FeedItemD | null }) => {
  if (!item) {
    return <FeedItemLoading />
  }

  return (
    <TextListCard
      href={`/d/${item.id}`}
      title={item.publicationType === 'short' ? '' : item.title || '<No Title>'}
      excerpt={item.publicationType === 'short' ? extractReadableText(item.content.html) : undefined}
      subtitle={item.subtitle}
      signed={false}
    />
  );
}
