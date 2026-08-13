import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type CursorMap = Record<string, string | null>

const HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app']
const REQUEST_TIMEOUT_MS = 6000

function parseActors(value: string) {
  return [...new Set(
    value
      .split(/[\s,;]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => item.startsWith('@') ? item : `@${item}`)
  )].slice(0, 20)
}

function decodeCursor(value: string | null): CursorMap {
  if (!value) return {}
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorMap } catch { return {} }
}

function encodeCursor(value: CursorMap) {
  const active = Object.fromEntries(Object.entries(value).filter(([, cursor]) => Boolean(cursor)))
  return Object.keys(active).length ? Buffer.from(JSON.stringify(active), 'utf8').toString('base64url') : null
}

function extractImages(embed: AnyObject | undefined) {
  if (!embed) return [] as { thumb: string; fullsize: string; alt: string }[]
  const source = embed.media ?? embed
  if (Array.isArray(source.images)) {
    return source.images.map((image: AnyObject) => ({
      thumb: image.thumb,
      fullsize: image.fullsize,
      alt: typeof image.alt === 'string' ? image.alt : ''
    })).filter((image: AnyObject) => image.thumb && image.fullsize)
  }
  return []
}

function extractVideo(embed: AnyObject | undefined) {
  if (!embed) return null
  const source = embed.media ?? embed
  if (!source.playlist) return null
  const playlist = String(source.playlist)
  return {
    playlist,
    thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : playlist.replace(/playlist\.m3u8(?:\?.*)?$/, 'thumbnail.jpg'),
    alt: typeof source.alt === 'string' ? source.alt : '',
    aspectRatio: source.aspectRatio && typeof source.aspectRatio.width === 'number' && typeof source.aspectRatio.height === 'number'
      ? { width: source.aspectRatio.width, height: source.aspectRatio.height }
      : null
  }
}

async function xrpc(path: string, params: URLSearchParams) {
  for (const host of HOSTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${host}/xrpc/${path}?${params.toString()}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'VisualAccountFeed/1.0' },
        cache: 'no-store',
        signal: controller.signal
      })
      if (response.ok) return await response.json()
    } catch {
      // fallback host
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

async function fetchActor(actorWithAt: string, cursor: string | null) {
  const actor = actorWithAt.replace(/^@+/, '')
  const params = new URLSearchParams({ actor, limit: '100', filter: 'posts_with_media', includePins: 'false' })
  if (cursor) params.set('cursor', cursor)
  const data = await xrpc('app.bsky.feed.getAuthorFeed', params)
  if (!data) return { actor: actorWithAt, posts: [] as AnyObject[], cursor: null as string | null }

  const posts: AnyObject[] = []
  for (const item of Array.isArray(data.feed) ? data.feed : []) {
    const post = item?.post
    if (!post?.uri) continue
    const images = extractImages(post.embed)
    const video = extractVideo(post.embed)
    if (!images.length && !video) continue
    const handle = String(post.author?.handle ?? actor)
    const feedTime = item?.reason?.indexedAt ?? post.indexedAt ?? post.record?.createdAt ?? ''
    posts.push({
      uri: post.uri,
      cid: post.cid,
      text: typeof post.record?.text === 'string' ? post.record.text : '',
      createdAt: feedTime,
      indexedAt: feedTime,
      author: {
        handle,
        displayName: post.author?.displayName ?? handle,
        avatar: post.author?.avatar ?? null
      },
      images,
      video,
      likeCount: post.likeCount ?? 0,
      repostCount: post.repostCount ?? 0
    })
  }

  return { actor: actorWithAt, posts, cursor: data.cursor ?? null }
}

export async function GET(request: NextRequest) {
  const actors = parseActors(request.nextUrl.searchParams.get('q')?.trim() ?? '')
  if (!actors.length) return NextResponse.json({ error: 'Aucun compte.' }, { status: 400 })
  const cursors = decodeCursor(request.nextUrl.searchParams.get('cursor'))

  try {
    const feeds = await Promise.all(actors.map(actor => fetchActor(actor, cursors[actor] ?? null)))
    const seen = new Set<string>()
    const posts: AnyObject[] = []
    const nextCursors: CursorMap = {}

    for (const feed of feeds) {
      nextCursors[feed.actor] = feed.cursor
      for (const post of feed.posts) {
        if (seen.has(post.uri)) continue
        seen.add(post.uri)
        posts.push(post)
      }
    }

    posts.sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))
    return NextResponse.json({ posts, cursor: encodeCursor(nextCursors) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Impossible de charger ces comptes.' }, { status: 502 })
  }
}
