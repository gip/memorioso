'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const RightPanePortal = ({ children }: { children: ReactNode }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setTarget(document.getElementById('site-right-pane'))
  }, [])

  return target ? createPortal(children, target) : null
}
