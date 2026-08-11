import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Recherche photos publiques',
  description: 'Recherche de photos publiques à partir de mots-clés.'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
