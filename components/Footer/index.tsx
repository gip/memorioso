import { Divider } from '../Divider'
import { cn } from '@/lib/utils'

export const Footer = ({ className }: { className?: string }) => (
  <footer className={cn('mb-8 mt-auto', className)}>
    <Divider />
    <div className="mt-4 text-center text-xs">
      <div>
        <i>
          Memorioso is currently in the{' '}
          <a href="/p/2" className="text-blurple hover:underline">Make It Work</a> stage.
        </i>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 whitespace-nowrap">
        <a href="/terms" className="text-blurple hover:underline">Terms of Use</a>
        <span>•</span>
        <a href="/privacy" className="text-blurple hover:underline">Privacy Policy</a>
      </div>
    </div>
  </footer>
)
