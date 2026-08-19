import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function probe(url: string, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; VisualSearch/1.0; +https://ia-perso.vercel.app)',
        ...headers
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000)
    })
    return { status: response.status, ok: response.ok, contentType: response.headers.get('content-type') }
  } catch (error) {
    return { status: 0, ok: false, error: error instanceof Error ? error.name : 'unknown' }
  }
}

export async function GET() {
  const qs = 'q=cat&limit=1&sort=latest'
  const [publicApi, api, entrywayProxy, entrywayDefault] = await Promise.all([
    probe(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?${qs}`),
    probe(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${qs}`),
    probe(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?${qs}`, {
      'atproto-proxy': 'did:web:api.bsky.app#bsky_appview'
    }),
    probe(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?${qs}`)
  ])

  return NextResponse.json({ publicApi, api, entrywayProxy, entrywayDefault }, { headers: { 'cache-control': 'no-store' } })
}
