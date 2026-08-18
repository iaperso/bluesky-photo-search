import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type SearchResult = { posts: AnyObject[]; cursor: string | null; hitsTotal: number | null }

const HOSTS = ['https://api.bsky.app', 'https://public.api.bsky.app']
const PHOTO_ORIGIN = 'https://photo-search-xi-nine.vercel.app'
const IA_ORIGIN = 'https://ia-perso.vercel.app'
const ADULT_LABELS = new Set(['porn', 'sexual'])
const REQUEST_TIMEOUT_MS = 4500
const TARGET_RESULTS = 10
const MAX_SCANS = 3

function hasAdultLabel(post: AnyObject) {
  return (Array.isArray(post.labels) && post.labels.some((label: AnyObject) => !label?.neg && ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))) ||
    (Array.isArray(post.record?.labels?.values) && post.record.labels.values.some((label: AnyObject) => ADULT_LABELS.has(String(label?.val ?? '').toLowerCase())))
}

function extractVideo(embed: AnyObject | undefined) {
  if (!embed) return null
  const source = embed.media ?? embed
  if (!source.playlist) return null
  const playlist = source.playlist as string
  return {
    playlist,
    thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : playlist.replace(/playlist\.m3u8(?:\?.*)?$/, 'thumbnail.jpg'),
    alt: '',
    aspectRatio: source.aspectRatio && typeof source.aspectRatio.width === 'number' && typeof source.aspectRatio.height === 'number'
      ? { width: source.aspectRatio.width, height: source.aspectRatio.height }
      : null
  }
}

function exactHandle(value: unknown) {
  if (typeof value !== 'string') return 'auteur'
  const handle = value.trim().replace(/^@+/, '')
  return handle || 'auteur'
}

function searchVariants(q: string) {
  const variants = new Set<string>([q])
  for (const raw of q.split(/\s+/)) {
    if (!raw || raw.startsWith('@') || raw.includes('://')) continue
    const word = raw.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').trim()
    if (word) variants.add(`#${word}`)
    if (variants.size >= 4) break
  }
  return [...variants]
}

async function searchRemote(params: URLSearchParams) {
  for (const host of HOSTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${host}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
        },
        cache: 'no-store',
        signal: controller.signal
      })
      if (response.ok) return await response.json()
    } catch {
      // Try the fallback host.
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function relayVideos(request: NextRequest) {
  if (request.headers.get('x-photo-search-relay') === '1') return null

  const incomingHost = request.headers.get('host')?.toLowerCase() ?? ''
  const relayOrigin = incomingHost.startsWith('ia-perso.') ? PHOTO_ORIGIN : IA_ORIGIN

  try {
    const relayUrl = new URL('/api/videos', relayOrigin)
    request.nextUrl.searchParams.forEach((value, key) => relayUrl.searchParams.append(key, value))
    const response = await fetch(relayUrl, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'x-photo-search-relay': '1'
      },
      cache: 'no-store'
    })
    if (!response.ok) return null
    const payload = await response.json()
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60',
        'x-photo-search-source': 'peer-relay'
      }
    })
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const requestedCursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
  if (!q) return NextResponse.json({ error: 'vide' }, { status: 400 })

  let until = requestedCursor && !Number.isNaN(Date.parse(requestedCursor)) ? requestedCursor : null
  let cursor: string | null = null
  const posts: AnyObject[] = []
  const seenUris = new Set<string>()
  const seenPlaylists = new Set<string>()
  const variants = searchVariants(q)

  for (let scan = 0; scan < MAX_SCANS; scan += 1) {
    const pages = await Promise.all(variants.map(async searchQuery => {
      const params = new URLSearchParams({ q: searchQuery, sort: 'latest', limit: '100' })
      if (until) params.set('until', until)
      return searchRemote(params)
    }))

    const successful = pages.filter(Boolean)
    if (!successful.length) {
      if (posts.length) break
      const relayed = await relayVideos(request)
      if (relayed) return relayed
      return NextResponse.json({ error: 'distante' }, { status: 502 })
    }

    let boundary: string | null = null
    for (const data of successful) {
      const rawPosts: AnyObject[] = Array.isArray(data.posts) ? data.posts : []
      for (const post of rawPosts) {
        const indexed = post.indexedAt ?? post.record?.createdAt
        if (typeof indexed === 'string' && !Number.isNaN(Date.parse(indexed)) && (!boundary || Date.parse(indexed) < Date.parse(boundary))) boundary = indexed
        if (!hasAdultLabel(post) || seenUris.has(post.uri)) continue
        const video = extractVideo(post.embed)
        if (!video || seenPlaylists.has(video.playlist)) continue
        seenUris.add(post.uri)
        seenPlaylists.add(video.playlist)
        const handle = exactHandle(post.author?.handle ?? post.author?.did)
        posts.push({
          uri: post.uri,
          cid: post.cid,
          text: '',
          createdAt: post.record?.createdAt ?? post.indexedAt,
          author: {
            handle,
            displayName: typeof post.author?.displayName === 'string' && post.author.displayName.trim() ? post.author.displayName.trim() : handle,
            avatar: post.author?.avatar ?? null
          },
          video,
          likeCount: post.likeCount ?? 0,
          repostCount: post.repostCount ?? 0
        })
      }
    }

    cursor = boundary
    until = boundary
    if (posts.length >= TARGET_RESULTS || !boundary) break
  }

  return NextResponse.json(
    { posts, cursor, hitsTotal: null } satisfies SearchResult,
    { headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=60' } }
  )
}
