import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>
type SearchResult = { posts: AnyObject[]; cursor: string | null; hitsTotal: number | null }

const HOSTS = ['https://public.api.bsky.app', 'https://api.bsky.app']
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

function hasAdultLabel(post: AnyObject) {
  const serviceLabels = Array.isArray(post.labels)
    ? post.labels.some((label: AnyObject) => !label?.neg && ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))
    : false
  const selfLabels = Array.isArray(post.record?.labels?.values)
    ? post.record.labels.values.some((label: AnyObject) => ADULT_LABELS.has(String(label?.val ?? '').toLowerCase()))
    : false
  return serviceLabels || selfLabels
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

function normalizePosts(rawPosts: AnyObject[]) {
  return rawPosts.flatMap(post => {
    if (!hasAdultLabel(post)) return []
    const video = extractVideo(post.embed)
    if (!video) return []
    return [{
      uri: post.uri,
      cid: post.cid,
      text: cleanVisibleText(post.record?.text),
      createdAt: post.record?.createdAt ?? post.indexedAt,
      indexedAt: post.indexedAt,
      author: { handle: 'auteur', displayName: 'auteur', avatar: post.author?.avatar ?? null },
      video,
      likeCount: post.likeCount ?? 0,
      repostCount: post.repostCount ?? 0
    }]
  })
}

function pageBoundary(rawPosts: AnyObject[]) {
  const last = rawPosts.at(-1)
  const value = last?.indexedAt ?? last?.record?.createdAt
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function hashtagSearches(q: string) {
  const variants = new Set<string>([q])
  for (const rawWord of q.split(/\s+/)) {
    if (!rawWord || rawWord.startsWith('@') || rawWord.includes('://')) continue
    const word = rawWord.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').trim()
    if (word) variants.add(`#${word}`)
  }
  return [...variants]
}

function newestBoundary(boundaries: Array<string | null>) {
  const valid = boundaries.filter((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
  if (!valid.length) return null
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest)
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

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const requestedCursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
  if (!q) return NextResponse.json({ error: 'La recherche est vide.' }, { status: 400 })

  try {
    let until = requestedCursor && !Number.isNaN(Date.parse(requestedCursor)) ? requestedCursor : null
    let hitsTotal: number | null = null
    let nextCursor: string | null = null
    const collected: AnyObject[] = []
    const seen = new Set<string>()

    for (let scan = 0; scan < 6; scan += 1) {
      const results = await Promise.all(hashtagSearches(q).map(searchQuery => {
        const params = new URLSearchParams({ q: searchQuery, sort: 'latest', limit: '100' })
        if (until) params.set('until', until)
        return xrpc('app.bsky.feed.searchPosts', params)
      }))

      const successful = results.filter(result => result.data)
      if (!successful.length) {
        const failed = results[0]
        return NextResponse.json({ error: `La recherche distante a échoué (${failed.status}).` }, { status: failed.status })
      }
      if (hitsTotal === null && typeof successful[0].data.hitsTotal === 'number') hitsTotal = successful[0].data.hitsTotal

      const boundaries: Array<string | null> = []
      let foundRawPosts = false
      for (const result of successful) {
        const rawPosts: AnyObject[] = Array.isArray(result.data.posts) ? result.data.posts : []
        if (!rawPosts.length) continue
        foundRawPosts = true
        boundaries.push(pageBoundary(rawPosts))
        for (const post of normalizePosts(rawPosts)) {
          if (!post?.uri || seen.has(post.uri)) continue
          seen.add(post.uri)
          collected.push(post)
        }
      }

      if (!foundRawPosts) { nextCursor = null; break }
      nextCursor = newestBoundary(boundaries)
      until = nextCursor
      if (collected.length >= 12 || !nextCursor) break
    }

    return NextResponse.json({ posts: collected, cursor: nextCursor, hitsTotal } satisfies SearchResult)
  } catch {
    return NextResponse.json({ error: 'Impossible de joindre le service de recherche pour le moment.' }, { status: 502 })
  }
}
