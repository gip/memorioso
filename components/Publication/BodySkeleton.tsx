import { TextLines } from './skeleton-parts'

export const PublicationBodySkeleton = () => (
  <div aria-busy="true" aria-label="Loading publication body" className="space-y-8">
    <TextLines widths={['w-full', 'w-[96%]', 'w-[89%]', 'w-[62%]']} />
    <TextLines widths={['w-full', 'w-[93%]', 'w-[97%]', 'w-[74%]']} />
    <TextLines widths={['w-[95%]', 'w-[86%]', 'w-[55%]']} />
  </div>
)
