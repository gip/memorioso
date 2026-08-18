import { Skeleton } from '@/components/ui/skeleton'

const FactRowSkeleton = () => (
  <div className="flex items-baseline gap-4 py-2.5">
    <Skeleton className="h-3 w-20 shrink-0" />
    <Skeleton className="h-3.5 w-40" />
  </div>
)

export const ProofSkeleton = () => (
  <article aria-busy="true" aria-label="Loading verification" className="pb-16 pt-8">
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 w-4 rounded-sm" />
      <Skeleton className="h-3 w-16" />
    </div>

    <Skeleton className="mt-4 h-9 w-2/3 max-w-72 rounded-lg" />

    <div className="mt-4 space-y-2">
      <Skeleton className="h-3.5 w-full max-w-md" />
      <Skeleton className="h-3.5 w-4/5 max-w-sm" />
    </div>

    <div className="mt-7 border-t border-zinc-100 pt-1">
      <dl className="divide-y divide-zinc-100">
        <FactRowSkeleton />
        <FactRowSkeleton />
        <FactRowSkeleton />
        <FactRowSkeleton />
      </dl>
    </div>

    <section className="mt-9">
      <Skeleton className="h-6 w-48" />
      <div className="mt-2 space-y-2">
        <Skeleton className="h-3.5 w-full max-w-lg" />
        <Skeleton className="h-3.5 w-3/5 max-w-xs" />
      </div>
      <Skeleton className="mt-4 h-48 w-full rounded-xl" />
    </section>

    <div className="mt-10 flex justify-center">
      <Skeleton className="h-3 w-32" />
    </div>
  </article>
)
