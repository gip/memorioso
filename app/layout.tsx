import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({ subsets: ['latin'] })

// viewportFit cover lets the app extend under notches in the World App webview;
// safe-area insets are applied where UI touches screen edges.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Memorioso',
  description: 'A protocol to protect and preserve human-created texts, stories, novels, publications, articles, and pictures.',
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: 'Memorioso',
    description: 'A protocol to protect and preserve human-created texts, stories, novels, publications, articles, and pictures.',
    url: 'https://memorioso.xyz',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen flex flex-col">{children}</div>
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
