import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'
import { Providers } from './providers'
import { SiteChrome } from '@/components/SiteChrome'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({ subsets: ['latin'] })

function SiteChromeFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <div className="mx-auto grid w-full max-w-[740px] flex-1 grid-cols-1 px-4 lg:min-h-0 lg:max-w-none lg:grid-cols-[12rem_minmax(0,740px)_minmax(0,1fr)] lg:gap-4 lg:px-6 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,740px)_minmax(12rem,1fr)] xl:gap-8">
        <div className="min-h-full min-w-0 lg:col-start-2 lg:h-full lg:min-h-0 lg:overflow-y-auto">
          <div className="flex min-h-full min-w-0 flex-col lg:mx-auto lg:w-full lg:max-w-[700px]">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

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
          <Suspense fallback={<SiteChromeFallback>{children}</SiteChromeFallback>}>
            <SiteChrome>{children}</SiteChrome>
          </Suspense>
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
