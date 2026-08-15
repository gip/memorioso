import { RightPanePortal } from '@/components/SiteChrome/RightPanePortal'
import { Skeleton } from '@/components/ui/skeleton'
import { TextLines, VerificationSkeleton } from './skeleton-parts'

export const ShortSkeleton = () => (
  <>
    <RightPanePortal>
      <VerificationSkeleton />
    </RightPanePortal>

    <article
      aria-busy="true"
      aria-label="Loading short"
      className="pb-16 pt-5 sm:pb-20 sm:pt-10 xl:pt-16"
    >
      <VerificationSkeleton compact />

      <TextLines
        widths={['w-full', 'w-[92%]', 'w-[97%]', 'w-[68%]']}
        lineClassName="h-6 sm:h-7"
      />

      <div className="mt-8 border-t border-zinc-100 pt-5">
        <Skeleton className="h-3 w-40" />
      </div>

      <Skeleton className="mx-auto mt-10 h-7 w-7 rounded-full" />
    </article>
  </>
)
