import { Skeleton } from '@/components/ui/skeleton'

export const VerificationSkeleton = ({ compact = false }: { compact?: boolean }) => compact ? (
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

export const TextLines = ({
  widths,
  lineClassName = 'h-4',
}: {
  widths: string[]
  lineClassName?: string
}) => (
  <div className="space-y-3">
    {widths.map((width, index) => (
      <Skeleton key={`${width}-${index}`} className={`${lineClassName} ${width}`} />
    ))}
  </div>
)
