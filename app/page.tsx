'use client'

import { useContext } from 'react'
import { MiniKitContext } from '@/components/providers/MinikitProvider'
import { MiniHome }from '@/components/MiniHome'
import { Top } from '@/components/Top'

export default function Page() {
  const isMiniKitInstalled = useContext(MiniKitContext)

  return isMiniKitInstalled ? <MiniHome /> : <Top />
}
