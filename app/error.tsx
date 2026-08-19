'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ErrorState'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // Server component errors reach the client with their message stripped, so the
    // digest is the only handle that ties this page to the server log.
    console.error(error)
  }, [error])

  return <ErrorState digest={error.digest} retry={retry} />
}
