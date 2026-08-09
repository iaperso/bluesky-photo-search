import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOSTS = new Set(['cdn.bsky.app'])

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url')

  if (!rawUrl) {
    return NextResponse.json({ error: 'URL manquante.' }, { status: 400 })
  }

  let imageUrl: URL
  try {
    imageUrl = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'URL invalide.' }, { status: 400 })
  }

  if (imageUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(imageUrl.hostname)) {
    return NextResponse.json({ error: 'Source non autorisée.' }, { status: 403 })
  }

  try {
    const response = await fetch(imageUrl.toString(), { cache: 'no-store' })
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: 'Image indisponible.' }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Le fichier demandé n’est pas une image.' }, { status: 415 })
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline'
      }
    })
  } catch {
    return NextResponse.json({ error: 'Téléchargement impossible.' }, { status: 502 })
  }
}
