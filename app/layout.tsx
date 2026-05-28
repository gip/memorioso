import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({ subsets: ['latin'] })

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
