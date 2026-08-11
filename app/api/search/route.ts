import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>

type SearchResult = {
  posts: AnyObject[]
  cursor: string | null
  hitsTotal: number | null
}

const SEARCH_ENDPOINTS = [
  'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts',
  'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts'
]

function cleanVisibleText(value: string | null | undefined) {
  return (value ?? '')
    .replace(/https?:\/\/(?:www\.)?bsky\.app\/\S*/gi, '')
    .replace(/\.bsky\.social/gi, '')
    .replace(/blue\s*sky/gi, '')
    .replace(/bluesky/gi, '')
    .replace(/bsky\.app/gi, '')
    .replace(/bsky/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cleanHandle(value: string | null | undefined) {
  return cleanVisibleText(value).replace(/^@+/, '') || 'auteur'
}

function extractImages(embed: AnyObject | undefined) {
  if (!embed) return [] as { thumb: string; fullsize: string; alt: string }[]

  const source = embed.media ?? embed

  if (Array.isArray(source.images)) {
    return source.images
      .map((image: AnyObject) => ({
        thumb: image.thumb,
        fullsize: image.fullsize,
        alt: cleanVisibleText(image.alt)
      }))
      .filter((image: AnyObject) => image.thumb && image.fullsize)
  }

  if (Array.isArray(source.items)) {
    return source.items
      .map((image: AnyObject) => ({
        thumb: image.thumbnail ?? image.thumb,
        fullsize: image.fullsize,
        alt: cleanVisibleText(image.alt)
      }))
      .filter((image: AnyObject) => image.thumb && image.fullsize)
  }

  return []
}

function normalizeResults(data: AnyObject): SearchResult {
  const posts = (data.posts ?? [])
    .map((post: AnyObject) => {
      const images = extractImages(post.embed)
      if (!images.length) return null

      const rawHandle = post.author?.handle ?? post.author?.did ?? 'auteur'
      const handle = cleanHandle(rawHandle)
      const displayName = cleanVisibleText(post.author?.displayName) || handle

      return {
        uri: post.uri,
        cid: post.cid,
        text: cleanVisibleText(post.record?.text),
        createdAt: post.record?.createdAt ?? post.indexedAt,
        indexedAt: post.indexedAt,
        author: {
          handle,
          displayName,
          avatar: post.author?.avatar ?? null
        },
        images,
        likeCount: post.likeCount ?? 0,
        repostCount: post.repostCount ?? 0
      }
    })
    .filter(Boolean)

  return {
    posts,
    cursor: data.cursor ?? null,
    hitsTotal: data.hitsTotal ?? null
  }
}

async function queryEndpoint(url: string, params: URLSearchParams) {
  return fetch(`${url}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PublicPhotoSearch/1.0 (+https://vercel.app)',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
    },
    cache: 'no-store'
  })
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined
  const sort = request.nextUrl.searchParams.get('sort') === 'top' ? 'top' : 'latest'

  if (!q) {
    return NextResponse.json({ error: 'La recherche est vide.' }, { status: 400 })
  }

  const params = new URLSearchParams({ q, sort, limit: '50' })
  if (cursor) params.set('cursor', cursor)

  let lastStatus = 502
  let lastDetails = ''

  try {
    for (const endpoint of SEARCH_ENDPOINTS) {
      const response = await queryEndpoint(endpoint, params)

      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(normalizeResults(data))
      }

      lastStatus = response.status
      lastDetails = await response.text()

      if (response.status !== 403 && response.status !== 429 && response.status < 500) {
        break
      }
    }

    return NextResponse.json(
      {
        error: `La recherche distante a échoué (${lastStatus}).`,
        details: lastDetails
      },
      { status: lastStatus }
    )
  } catch {
    return NextResponse.json(
      { error: 'Impossible de joindre le service de recherche pour le moment.' },
      { status: 502 }
    )
  }
}
