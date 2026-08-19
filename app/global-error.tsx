'use client'

import { Inter } from 'next/font/google'
import { ErrorState } from '@/components/ErrorState'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

/**
 * Replaces the root layout when the layout itself fails, so it carries its own
 * document, font, and stylesheet. Everything the site chrome would normally supply
 * is unavailable here — keep it to what this file imports.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <title>Memorioso</title>
        <div className="flex min-h-screen flex-col">
          <ErrorState digest={error.digest} retry={retry} standalone />
        </div>
      </body>
    </html>
  )
}
