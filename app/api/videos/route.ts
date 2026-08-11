import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type SearchResult = { posts: AnyObject[]; cursor: string | null; hitsTotal: number | null }

const HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app']
const ADULT_LABELS = new Set(['porn', 'sexual'])

function hasAdultLabel(post: AnyObject) {
  return (Array.isArray(post.labels) && post.labels.some((label: AnyObject) => !label?.neg && ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))) ||
    (Array.isArray(post.record?.labels?.values) && post.record.labels.values.some((label: AnyObject) => ADULT_LABELS.has(String(label?.val ?? '').toLowerCase())))
}

function extractVideo(embed: AnyObject | undefined) {
  if (!embed) return null
  const source = embed.media ?? embed
  if (!source.playlist) return null
  return {
    playlist: source.playlist as string,
    thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : null,
    alt: '',
    aspectRatio: source.aspectRatio && typeof source.aspectRatio.width === 'number' && typeof source.aspectRatio.height === 'number'
      ? { width: source.aspectRatio.width, height: source.aspectRatio.height }
      : null
  }
}

function hashtagSearches(q: string) {
  const variants = new Set<string>([q])
  for (const raw of q.split(/\s+/)) {
    if (!raw || raw.startsWith('@') || raw.includes('://')) continue
    const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').trim()
    if (word) variants.add(`#${word}`)
  }
  return [...variants]
}

async function searchRemote(params: URLSearchParams) {
  for (const host of HOSTS) {
    const response = await fetch(`${host}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'PublicPhotoSearch/1.0 (+https://vercel.app)' },
      cache: 'no-store'
    })
    if (response.ok) return await response.json()
  }
  return null
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const requestedCursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
  if (!q) return NextResponse.json({ error: 'vide' }, { status: 400 })

  let until = requestedCursor && !Number.isNaN(Date.parse(requestedCursor)) ? requestedCursor : null
  let cursor: string | null = null
  const posts: AnyObject[] = []
  const seen = new Set<string>()

  for (let scan = 0; scan < 6; scan += 1) {
    const pages = await Promise.all(hashtagSearches(q).map(async searchQuery => {
      const params = new URLSearchParams({ q: searchQuery, sort: 'latest', limit: '100' })
      if (until) params.set('until', until)
      return searchRemote(params)
    }))

    const successful = pages.filter(Boolean)
    if (!successful.length) return NextResponse.json({ error: 'distante' }, { status: 502 })

    let boundary: string | null = null
    for (const data of successful) {
      const rawPosts: AnyObject[] = Array.isArray(data.posts) ? data.posts : []
      for (const post of rawPosts) {
        const indexed = post.indexedAt ?? post.record?.createdAt
        if (typeof indexed === 'string' && (!boundary || Date.parse(indexed) > Date.parse(boundary))) boundary = indexed
        if (!hasAdultLabel(post) || seen.has(post.uri)) continue
        const video = extractVideo(post.embed)
        if (!video) continue
        seen.add(post.uri)
        posts.push({
          uri: post.uri,
          cid: post.cid,
          text: '',
          createdAt: post.record?.createdAt ?? post.indexedAt,
          author: { handle: 'auteur', displayName: 'auteur', avatar: null },
          video,
          likeCount: post.likeCount ?? 0,
          repostCount: post.repostCount ?? 0
        })
      }
    }

    cursor = boundary
    until = boundary
    if (posts.length >= 12 || !boundary) break
  }

  return NextResponse.json({ posts, cursor, hitsTotal: null } satisfies SearchResult)
}
