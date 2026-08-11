import type { Metadata } from 'next'
import './globals.css'
import './age-gate.css'
import './mixed-media.css'
import './video-layout.css'
import './account-viewer.css'
import AccountVideoViewer from './AccountVideoViewer'

export const metadata: Metadata = {
  title: 'Recherche visuelle',
  description: 'Recherche visuelle'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}<AccountVideoViewer /></body>
    </html>
  )
}
