import type { Metadata } from 'next'
import './globals.css'
import './age-gate.css'

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
