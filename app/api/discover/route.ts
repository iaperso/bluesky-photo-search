import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type Kind = 'image' | 'video'

const HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app']
const ADULT_LABELS = new Set(['porn', 'sexual'])
const REQUEST_TIMEOUT_MS = 4500

function parseSeeds(value: string | null) {
  return [...new Set((value ?? '').split(/[\s,;]+/).map(v => v.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean))].slice(0, 12)
}

function hasAdultLabel(post: AnyObject) {
  return (Array.isArray(post.labels) && post.labels.some((label: AnyObject) => !label?.neg && ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))) ||
    (Array.isArray(post.record?.labels?.values) && post.record.labels.values.some((label: AnyObject) => ADULT_LABELS.has(String(label?.val ?? '').toLowerCase())))
}

function extractImages(embed: AnyObject | undefined) {
  if (!embed) return []
  const source = embed.media ?? embed
  if (!Array.isArray(source.images)) return []
  return source.images.map((image: AnyObject) => ({ thumb: image.thumb, fullsize: image.fullsize, alt: '' })).filter((image: AnyObject) => image.thumb && image.fullsize)
}

function extractVideo(embed: AnyObject | undefined) {
  if (!embed) return null
  const source = embed.media ?? embed
  if (!source.playlist) return null
  const playlist = String(source.playlist)
  return {
    playlist,
    thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : playlist.replace(/playlist\.m3u8(?:\?.*)?$/, 'thumbnail.jpg'),
    alt: '',
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
        headers: { Accept: 'application/json', 'User-Agent': 'VisualMediaDiscovery/1.0' },
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

async function authorFeed(actor: string, limit = 70) {
  const params = new URLSearchParams({ actor, limit: String(limit), filter: 'posts_with_media', includePins: 'false' })
  const data = await xrpc('app.bsky.feed.getAuthorFeed', params)
  return Array.isArray(data?.feed) ? data.feed : []
}

function weightedShuffle<T extends { affinity: number }>(items: T[]) {
  return [...items]
    .map(item => ({ item, score: Math.random() + Math.min(item.affinity, 5) * 0.22 }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item)
}

export async function GET(request: NextRequest) {
  const kind: Kind = request.nextUrl.searchParams.get('kind') === 'video' ? 'video' : 'image'
  const seeds = parseSeeds(request.nextUrl.searchParams.get('seeds'))
  if (!seeds.length) return NextResponse.json({ posts: [], cursor: null, hitsTotal: null })

  try {
    const seedSet = new Set(seeds)
    const affinity = new Map<string, number>()
    const seedFeeds = await Promise.all(seeds.map(seed => authorFeed(seed, 80)))

    for (let i = 0; i < seedFeeds.length; i += 1) {
      const seed = seeds[i]
      for (const item of seedFeeds[i]) {
        const handle = String(item?.post?.author?.handle ?? '').toLowerCase()
        if (!handle || handle === seed || seedSet.has(handle)) continue
        const isRepost = Boolean(item?.reason)
        affinity.set(handle, (affinity.get(handle) ?? 0) + (isRepost ? 3 : 1))
      }
    }

    const neighbors = [...affinity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)

    const neighborFeeds = await Promise.all(neighbors.map(([handle]) => authorFeed(handle, 45)))
    const seen = new Set<string>()
    const collected: Array<AnyObject & { affinity: number }> = []

    for (let i = 0; i < neighborFeeds.length; i += 1) {
      const [neighbor, weight] = neighbors[i]
      for (const item of neighborFeeds[i]) {
        const post = item?.post
        if (!post?.uri || seen.has(post.uri) || !hasAdultLabel(post)) continue
        const handle = String(post.author?.handle ?? '').toLowerCase()
        if (!handle || seedSet.has(handle)) continue

        const images = extractImages(post.embed)
        const video = extractVideo(post.embed)
        if (kind === 'image' && !images.length) continue
        if (kind === 'video' && !video) continue

        seen.add(post.uri)
        collected.push({
          uri: post.uri,
          cid: post.cid,
          text: '',
          createdAt: post.record?.createdAt ?? post.indexedAt,
          author: {
            handle: post.author?.handle ?? neighbor,
            displayName: post.author?.displayName ?? post.author?.handle ?? neighbor,
            avatar: post.author?.avatar ?? null
          },
          images: kind === 'image' ? images : undefined,
          video: kind === 'video' ? video : undefined,
          likeCount: post.likeCount ?? 0,
          repostCount: post.repostCount ?? 0,
          affinity: weight
        })
      }
    }

    const posts = weightedShuffle(collected).slice(0, kind === 'video' ? 18 : 30).map(({ affinity: _affinity, ...post }) => post)
    return NextResponse.json({ posts, cursor: null, hitsTotal: null }, { headers: { 'Cache-Control': 'private, max-age=0, no-store' } })
  } catch {
    return NextResponse.json({ posts: [], cursor: null, hitsTotal: null })
  }
}
