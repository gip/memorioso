import { RightPanePortal } from '@/components/SiteChrome/RightPanePortal'
import { Skeleton } from '@/components/ui/skeleton'

const VerificationSkeleton = ({ compact = false }: { compact?: boolean }) => compact ? (
  <section
    aria-hidden
    className="mb-7 rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 sm:p-4 xl:hidden"
  >
    <div className="flex items-center gap-3.5">
      <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-24" />
      </div>
    </div>
  </section>
) : (
  <aside aria-hidden className="flex w-full max-w-[14rem] flex-col items-center py-8">
    <Skeleton className="h-28 w-28 rounded-full" />
    <Skeleton className="mt-4 h-4 w-32" />
    <Skeleton className="mt-3 h-3 w-40" />
    <div className="mt-6 w-full border-t border-zinc-200 pt-4">
      <Skeleton className="mx-2 h-3 w-28" />
      <Skeleton className="mx-2 mt-4 h-4 w-32" />
      <Skeleton className="mx-2 mt-4 h-4 w-24" />
    </div>
  </aside>
)

const TextLines = ({ widths }: { widths: string[] }) => (
  <div className="space-y-3">
    {widths.map((width, index) => (
      <Skeleton key={`${width}-${index}`} className={`h-4 ${width}`} />
    ))}
  </div>
)

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
