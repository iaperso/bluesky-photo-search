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

const ADULT_LABELS = new Set(['porn', 'sexual'])

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

function hasAdultLabel(post: AnyObject) {
  const serviceLabels = Array.isArray(post.labels)
    ? post.labels.some((label: AnyObject) => !label?.neg && ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))
    : false

  const selfLabels = Array.isArray(post.record?.labels?.values)
    ? post.record.labels.values.some((label: AnyObject) => ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))
    : false

  return serviceLabels || selfLabels
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

function normalizePosts(rawPosts: AnyObject[], adultOnly: boolean) {
  return rawPosts
    .filter((post: AnyObject) => !adultOnly || hasAdultLabel(post))
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
}

function pageBoundary(rawPosts: AnyObject[]) {
  const last = rawPosts.at(-1)
  const value = last?.indexedAt ?? last?.record?.createdAt
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

async function queryBatch(params: URLSearchParams) {
  let lastStatus = 502
  let lastDetails = ''

  for (const endpoint of SEARCH_ENDPOINTS) {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PublicPhotoSearch/1.0 (+https://vercel.app)',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
      },
      cache: 'no-store'
    })

    if (response.ok) {
      return { data: await response.json(), status: 200, details: '' }
    }

    lastStatus = response.status
    lastDetails = await response.text()

    if (response.status !== 403 && response.status !== 429 && response.status < 500) {
      break
    }
  }

  return { data: null, status: lastStatus, details: lastDetails }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const requestedCursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
  const sort = request.nextUrl.searchParams.get('sort') === 'top' ? 'top' : 'latest'
  const adultOnly = request.nextUrl.searchParams.get('mode') === 'adult'

  if (!q) {
    return NextResponse.json({ error: 'La recherche est vide.' }, { status: 400 })
  }

  let until = requestedCursor && !Number.isNaN(Date.parse(requestedCursor)) ? requestedCursor : null
  let hitsTotal: number | null = null
  let nextCursor: string | null = null
  const collected: AnyObject[] = []
  const seen = new Set<string>()
  const scans = adultOnly ? 4 : 1

  try {
    for (let scan = 0; scan < scans; scan += 1) {
      const params = new URLSearchParams({ q, sort, limit: '100' })
      if (until) params.set('until', until)

      const result = await queryBatch(params)
      if (!result.data) {
        return NextResponse.json(
          { error: `La recherche distante a échoué (${result.status}).`, details: result.details },
          { status: result.status }
        )
      }

      if (hitsTotal === null && typeof result.data.hitsTotal === 'number') {
        hitsTotal = result.data.hitsTotal
      }

      const rawPosts: AnyObject[] = Array.isArray(result.data.posts) ? result.data.posts : []
      if (!rawPosts.length) {
        nextCursor = null
        break
      }

      const normalized = normalizePosts(rawPosts, adultOnly)
      for (const post of normalized) {
        if (!post?.uri || seen.has(post.uri)) continue
        seen.add(post.uri)
        collected.push(post)
      }

      nextCursor = pageBoundary(rawPosts)
      until = nextCursor

      if (!adultOnly || collected.length >= 20 || !nextCursor) break
    }

    const response: SearchResult = {
      posts: collected,
      cursor: nextCursor,
      hitsTotal
    }

    return NextResponse.json(response)
  } catch {
    return NextResponse.json(
      { error: 'Impossible de joindre le service de recherche pour le moment.' },
      { status: 502 }
    )
  }
}
