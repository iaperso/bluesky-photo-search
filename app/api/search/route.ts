import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>

type SearchResult = {
  posts: AnyObject[]
  cursor: string | null
  hitsTotal: number | null
}

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

    if (response.ok) {
      return { data: await response.json(), status: 200, details: '' }
    }

    lastStatus = response.status
    lastDetails = await response.text()

    if (response.status !== 403 && response.status !== 429 && response.status < 500) break
  }

  return { data: null, status: lastStatus, details: lastDetails }
}

async function authorPhotos(actor: string, adultOnly: boolean, cursor?: string | null, limit = 100) {
  const params = new URLSearchParams({ actor, limit: String(limit), filter: 'posts_with_media', includePins: 'false' })
  if (cursor) params.set('cursor', cursor)

  const result = await xrpc('app.bsky.feed.getAuthorFeed', params)
  if (!result.data) return { posts: [] as AnyObject[], cursor: null as string | null, status: result.status, details: result.details }

  const rawPosts = (Array.isArray(result.data.feed) ? result.data.feed : [])
    .map((item: AnyObject) => item?.post)
    .filter(Boolean)

  return {
    posts: normalizePosts(rawPosts, adultOnly),
    cursor: result.data.cursor ?? null,
    status: 200,
    details: ''
  }
}

function directActorFromQuery(q: string) {
  const actor = q.trim().replace(/^@+/, '')
  if (!actor || /\s/.test(actor)) return null
  if (actor.startsWith('did:') || actor.includes('.')) return actor
  return null
}

async function actorMatches(q: string) {
  const params = new URLSearchParams({ q: q.replace(/^@+/, ''), limit: '4' })
  const result = await xrpc('app.bsky.actor.searchActors', params)
  if (!result.data || !Array.isArray(result.data.actors)) return [] as string[]

  return result.data.actors
    .map((actor: AnyObject) => actor?.handle ?? actor?.did)
    .filter((actor: unknown): actor is string => typeof actor === 'string' && actor.length > 0)
    .slice(0, 4)
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const requestedCursor = request.nextUrl.searchParams.get('cursor')?.trim() || null
  const sort = request.nextUrl.searchParams.get('sort') === 'top' ? 'top' : 'latest'
  const adultOnly = request.nextUrl.searchParams.get('mode') === 'adult'

  if (!q) return NextResponse.json({ error: 'La recherche est vide.' }, { status: 400 })

  try {
    const directActor = directActorFromQuery(q)

    if (directActor) {
      const actorCursor = requestedCursor?.startsWith('actor:') ? requestedCursor.slice(6) : null
      const result = await authorPhotos(directActor, adultOnly, actorCursor, 100)

      if (result.status !== 200) {
        return NextResponse.json(
          { error: `La recherche distante a échoué (${result.status}).`, details: result.details },
          { status: result.status }
        )
      }

      return NextResponse.json({
        posts: result.posts,
        cursor: result.cursor ? `actor:${result.cursor}` : null,
        hitsTotal: null
      } satisfies SearchResult)
    }

    let until = requestedCursor && !requestedCursor.startsWith('actor:') && !Number.isNaN(Date.parse(requestedCursor))
      ? requestedCursor
      : null
    let hitsTotal: number | null = null
    let nextCursor: string | null = null
    const collected: AnyObject[] = []
    const seen = new Set<string>()

    if (!requestedCursor) {
      const actors = await actorMatches(q)
      const actorFeeds = await Promise.all(actors.map(actor => authorPhotos(actor, adultOnly, null, 30)))
      for (const feed of actorFeeds) {
        for (const post of feed.posts) {
          if (!post?.uri || seen.has(post.uri)) continue
          seen.add(post.uri)
          collected.push(post)
        }
      }
    }

    const scans = adultOnly ? 4 : 1

    for (let scan = 0; scan < scans; scan += 1) {
      const params = new URLSearchParams({ q, sort, limit: '100' })
      if (until) params.set('until', until)

      const result = await xrpc('app.bsky.feed.searchPosts', params)
      if (!result.data) {
        return NextResponse.json(
          { error: `La recherche distante a échoué (${result.status}).`, details: result.details },
          { status: result.status }
        )
      }

      if (hitsTotal === null && typeof result.data.hitsTotal === 'number') hitsTotal = result.data.hitsTotal

      const rawPosts: AnyObject[] = Array.isArray(result.data.posts) ? result.data.posts : []
      if (!rawPosts.length) {
        nextCursor = null
        break
      }

      for (const post of normalizePosts(rawPosts, adultOnly)) {
        if (!post?.uri || seen.has(post.uri)) continue
        seen.add(post.uri)
        collected.push(post)
      }

      nextCursor = pageBoundary(rawPosts)
      until = nextCursor
      if (!adultOnly || collected.length >= 24 || !nextCursor) break
    }

    collected.sort((a, b) => Date.parse(b.createdAt ?? b.indexedAt ?? '') - Date.parse(a.createdAt ?? a.indexedAt ?? ''))

    return NextResponse.json({
      posts: collected,
      cursor: nextCursor,
      hitsTotal
    } satisfies SearchResult)
  } catch {
    return NextResponse.json(
      { error: 'Impossible de joindre le service de recherche pour le moment.' },
      { status: 502 }
    )
  }
}
