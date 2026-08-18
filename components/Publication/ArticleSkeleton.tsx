import { RightPanePortal } from '@/components/SiteChrome/RightPanePortal'
import { Skeleton } from '@/components/ui/skeleton'
import { TextLines, VerificationSkeleton } from './skeleton-parts'

export const ArticleSkeleton = () => (
  <>
    <RightPanePortal>
      <VerificationSkeleton />
    </RightPanePortal>

    <article
      aria-busy="true"
      aria-label="Loading article"
      className="pb-16 pt-5 sm:pb-20 sm:pt-8 xl:pt-12"
    >
      <VerificationSkeleton compact />

      <header className="text-center">
        <Skeleton className="mx-auto h-10 w-4/5 max-w-[30rem] rounded-lg sm:h-12" />
        <Skeleton className="mx-auto mt-4 h-5 w-2/5 max-w-56" />
        <Skeleton className="mx-auto mt-6 h-3 w-48" />
      </header>

      <div className="my-7 h-px bg-zinc-100 sm:my-9" />

      <div className="space-y-8">
        <TextLines widths={['w-full', 'w-[96%]', 'w-[89%]', 'w-[62%]']} />
        <TextLines widths={['w-full', 'w-[93%]', 'w-[97%]', 'w-[74%]']} />
        <TextLines widths={['w-[95%]', 'w-[86%]', 'w-[55%]']} />
      </div>

      <Skeleton className="mx-auto mt-10 h-7 w-7 rounded-full" />
    </article>
  </>
)
