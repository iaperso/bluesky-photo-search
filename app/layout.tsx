import type { Metadata } from 'next'
import './globals.css'
import './age-gate.css'
import './mixed-media.css'
import './video-layout.css'

export const metadata: Metadata = {
  title: 'Recherche visuelle',
  description: 'Recherche visuelle'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
