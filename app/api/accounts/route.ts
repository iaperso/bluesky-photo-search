import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type CursorMap = Record<string, string | null>

const HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app']
const ADULT_LABELS = new Set(['porn', 'sexual'])
const FLOW_COOKIE = 'visual-search-flow-accounts'

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

function extractVideo(embed: AnyObject | undefined) {
  if (!embed) return null
  const source = embed.media ?? embed
  const type = String(source.$type ?? '')
  if (!type.includes('app.bsky.embed.video') && !source.playlist) return null
  if (!source.playlist) return null

  return {
    playlist: source.playlist as string,
    thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : null,
    alt: cleanVisibleText(source.alt),
    aspectRatio: source.aspectRatio && typeof source.aspectRatio.width === 'number' && typeof source.aspectRatio.height === 'number'
      ? { width: source.aspectRatio.width, height: source.aspectRatio.height }
      : null
  }
}

function normalizePost(post: AnyObject, feedIndexedAt?: string | null, allowUnlabeled = false) {
  if (!allowUnlabeled && !hasAdultLabel(post)) return null

  const images = extractImages(post.embed)
  const video = extractVideo(post.embed)
  if (!images.length && !video) return null

  const rawHandle = post.author?.handle ?? post.author?.did ?? 'auteur'
  const handle = cleanHandle(rawHandle)
  const displayName = cleanVisibleText(post.author?.displayName) || handle
  const feedTime = feedIndexedAt ?? post.indexedAt ?? post.record?.createdAt

  return {
    uri: post.uri,
    cid: post.cid,
    text: cleanVisibleText(post.record?.text),
    createdAt: feedTime,
    indexedAt: feedTime,
    author: {
      handle,
      displayName,
      avatar: post.author?.avatar ?? null
    },
    images,
    video,
    likeCount: post.likeCount ?? 0,
    repostCount: post.repostCount ?? 0
  }
}

async function xrpc(path: string, params: URLSearchParams) {
  let lastStatus = 502
  let lastDetails = ''

  for (const host of HOSTS) {
    const response = await fetch(`${host}/xrpc/${path}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'PublicPhotoSearch/1.0 (+https://vercel.app)',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
      },
      cache: 'no-store'
    })

    if (response.ok) return { data: await response.json(), status: 200, details: '' }
    lastStatus = response.status
    lastDetails = await response.text()
    if (response.status !== 403 && response.status !== 429 && response.status < 500) break
  }

  return { data: null, status: lastStatus, details: lastDetails }
}

function parseActors(value: string) {
  return [...new Set(
    value
      .split(/[\s,;]+/)
      .map(item => item.trim().replace(/^@+/, ''))
      .filter(Boolean)
  )].slice(0, 20)
}

function parseFlowActors(value: string | undefined) {
  if (!value) return new Set<string>()
  try {
    return new Set(
      decodeURIComponent(value)
        .split(',')
        .map(item => item.trim().replace(/^@+/, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 20)
    )
  } catch {
    return new Set<string>()
  }
}

function decodeCursor(value: string | null): CursorMap {
  if (!value) return {}
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorMap
  } catch {
    return {}
  }
}

function encodeCursor(value: CursorMap) {
  const active = Object.fromEntries(Object.entries(value).filter(([, cursor]) => Boolean(cursor)))
  if (!Object.keys(active).length) return null
  return Buffer.from(JSON.stringify(active), 'utf8').toString('base64url')
}

async function fetchActor(actor: string, cursor: string | null, allowUnlabeled: boolean) {
  const params = new URLSearchParams({ actor, limit: '100', filter: 'posts_with_media', includePins: 'false' })
  if (cursor) params.set('cursor', cursor)

  const result = await xrpc('app.bsky.feed.getAuthorFeed', params)
  if (!result.data) return { actor, posts: [] as AnyObject[], cursor: null as string | null }

  const posts = (Array.isArray(result.data.feed) ? result.data.feed : [])
    .map((item: AnyObject) => {
      const post = item?.post
      if (!post) return null
      const feedIndexedAt = typeof item?.reason?.indexedAt === 'string'
        ? item.reason.indexedAt
        : typeof post.indexedAt === 'string'
          ? post.indexedAt
          : null
      return normalizePost(post, feedIndexedAt, allowUnlabeled)
    })
    .filter(Boolean) as AnyObject[]

  return { actor, posts, cursor: result.data.cursor ?? null }
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const actors = parseActors(q)
  if (!actors.length) return NextResponse.json({ error: 'Aucun compte.' }, { status: 400 })

  const flowActors = parseFlowActors(request.cookies.get(FLOW_COOKIE)?.value)
  const cursors = decodeCursor(request.nextUrl.searchParams.get('cursor'))

  try {
    const feeds = await Promise.all(actors.map(actor => fetchActor(actor, cursors[actor] ?? null, flowActors.has(actor.toLowerCase()))))
    const seen = new Set<string>()
    const posts: AnyObject[] = []
    const nextCursors: CursorMap = {}

    for (const feed of feeds) {
      nextCursors[feed.actor] = feed.cursor
      for (const post of feed.posts) {
        if (!post?.uri || seen.has(post.uri)) continue
        seen.add(post.uri)
        posts.push(post)
      }
    }

    posts.sort((a, b) => Date.parse(b.createdAt ?? b.indexedAt ?? '') - Date.parse(a.createdAt ?? a.indexedAt ?? ''))

    return NextResponse.json({
      posts,
      cursor: encodeCursor(nextCursors)
    })
  } catch {
    return NextResponse.json({ error: 'Impossible de charger ces comptes.' }, { status: 502 })
  }
}
