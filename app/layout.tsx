import type { Metadata } from 'next'
import './globals.css'
import './age-gate.css'
import './mixed-media.css'
import './video-layout.css'
import './viewer.css'
import './premium-header.css'
import './flow-premium.css'
import MediaViewer from './MediaViewer'
import AccountNames from './AccountNames'

export const metadata: Metadata = {
  title: 'VISUAL SEARCH',
  description: 'VISUAL SEARCH'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        {children}
        <AccountNames />
        <MediaViewer />
      </body>
    </html>
  )
}
