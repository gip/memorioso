// The Memorioso mark: the 〄 glyph, rotated and rendered as vector geometry.
// Shared across surfaces (header, seal, bylines, feed cards) so the brand
// reads consistently everywhere.
//
// The outline is the U+3004 glyph traced into a 100x100 box whose bounds are
// the glyph's exact ink bounds, so the mark is centred on the box centre and
// stays centred under rotation. Drawing it as a path (rather than as text)
// also keeps the mark identical on platforms whose fonts have no U+3004.

const MARK_PATH =
  'M68.9 8.3C76.1 12 79.1 14 82.9 18C91.3 26.8 95.9 38 95.9 50C95.9 70 83.3 87.3 64.3 93.6C60.4 94.9 57 95.4 50 95.9V100C55.2 99.7 59 99.3 61.7 98.7C66.1 97.7 71.5 95.4 76 92.7C91 83.5 100 67.5 100 50C100 35.6 93.9 22.2 83.1 12.5C77.9 8 74.1 5.7 64.8 2.2V30.9C64.8 35.7 62.6 38.3 58.9 38.3C55.3 38.3 53.4 36.3 52.1 31.2H48V59.1C45.4 56.5 42.4 55.2 38.2 55.2C31.1 55.2 26.1 60 26.1 66.8C26.1 71.8 28.1 75.1 33.1 78.2C37.8 81.2 39.2 82.9 39.2 85.9C39.2 88.9 37 90.8 33.7 90.8C30.5 90.8 26.5 89.4 23.2 87.2C11.5 79.1 4.1 64.9 4.1 49.9C4.1 30 16.7 12.7 35.7 6.4C39.6 5.1 43 4.6 50 4.1V0C44.8 0.3 41 0.7 38.3 1.3C33.9 2.3 28.5 4.6 24 7.3C9 16.5 0 32.5 0 50C0 66 7.7 81.2 20.6 90.4C24.7 93.3 29.1 94.9 33.4 94.9C39.6 94.9 43.5 91.3 43.5 85.7C43.5 81.2 41.6 78.3 36 74.8C31.7 72.2 30.6 70.4 30.6 66.9C30.6 62.3 33.4 59.6 38.2 59.6C42.8 59.6 45.3 61.4 48 66.3H52.1V39.7C53.9 41.6 55.9 42.5 58.9 42.5C65.1 42.5 68.9 38.4 68.9 32Z'

type MemMarkProps = {
  size?: number
  rotate?: number
  className?: string
}

export const MemMark = ({ size = 28, rotate = 50, className = 'text-blurple' }: MemMarkProps) => (
  <svg
    aria-hidden
    focusable="false"
    viewBox="0 0 100 100"
    width={size}
    height={size}
    className={`inline-block shrink-0 align-middle ${className}`}
  >
    <path d={MARK_PATH} fill="currentColor" transform={`rotate(${rotate} 50 50)`} />
  </svg>
)
