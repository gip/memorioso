// The Libro human-authorship seal — a circular "Signed by a human" badge built around
// the 〄 mark. Used to celebrate a freshly signed publication.

import { MemMark } from '@/components/MemMark'

const BLURPLE_LINE = 'rgba(82,0,255,0.22)'
const BLURPLE = 'rgb(82 0 255)'

type HumanSealProps = {
  size?: number
  label?: boolean
  id?: string
}

export const HumanSeal = ({ size = 96, label = true, id = 'mem-human-seal' }: HumanSealProps) => {
  const r = size / 2
  const pathR = r - (label ? size * 0.135 : 0)

  return (
    <div
      aria-label="Signed by a human — Libro — Orb"
      className="relative shrink-0"
      role="img"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <defs>
          <path
            id={id}
            d={`M ${r},${r} m -${pathR},0 a ${pathR},${pathR} 0 1,1 ${pathR * 2},0 a ${pathR},${pathR} 0 1,1 -${pathR * 2},0`}
          />
        </defs>
        <circle cx={r} cy={r} r={r - 1} fill="none" stroke={BLURPLE_LINE} strokeWidth="1" />
        {label && (
          <text
            fontSize={size * 0.092}
            fontWeight="600"
            fill={BLURPLE}
            letterSpacing={size * 0.018}
            className="uppercase"
            style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
          >
            <textPath href={`#${id}`} startOffset="0%">
              · Signed by a human · Libro · Orb&nbsp;
            </textPath>
          </text>
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <MemMark size={size * 0.46} />
      </div>
    </div>
  )
}
