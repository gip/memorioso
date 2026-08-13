import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { SiteChrome } from '@/components/SiteChrome'
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
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: {
      url: '/apple-touch-icon.png?v=2',
      sizes: '180x180',
      type: 'image/png',
    },
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
          <SiteChrome />
          {/* On lg+ there is no header, so pages reserve room for the fixed
              brand and account clusters. */}
          <div className="min-h-screen flex flex-col lg:pt-16">{children}</div>
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
