// The Memorioso mark: the 〄 glyph, rotated and rendered in Spectral.
// Shared across surfaces (header, seal, bylines, feed cards) so the brand
// reads consistently everywhere.

type MemMarkProps = {
  size?: number
  rotate?: number
  className?: string
}

export const MemMark = ({ size = 28, rotate = 50, className = 'text-blurple' }: MemMarkProps) => (
  <span
    aria-hidden
    className={`spectral inline-block leading-none ${className}`}
    style={{ transform: `rotate(${rotate}deg)`, fontSize: size }}
  >
    〄
  </span>
)
