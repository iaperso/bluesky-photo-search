import type { Metadata } from 'next'
import './globals.css'
import './age-gate.css'
import './mixed-media.css'
import './video-layout.css'
import './viewer.css'
import './premium-header.css'
import './flow-premium.css'
import './watermark.css'
import './interaction-fixes.css'
import MediaViewer from './MediaViewer'
import AndroidVideoBridge from './AndroidVideoBridge'

export const metadata: Metadata = {
  title: 'VISUAL SEARCH',
  description: 'VISUAL SEARCH',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0
    }
  }
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        {children}
        <AndroidVideoBridge />
        <MediaViewer />
      </body>
    </html>
  )
}
