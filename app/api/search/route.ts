import { NextRequest, NextResponse } from 'next/server'

type AnyObject = Record<string, any>

const BSKY_SEARCH = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts'

function extractImages(embed: AnyObject | undefined) {
  if (!embed) return [] as { thumb: string; fullsize: string; alt: string }[]

  const source = embed.media ?? embed

  if (Array.isArray(source.images)) {
    return source.images
      .map((image: AnyObject) => ({
        thumb: image.thumb,
        fullsize: image.fullsize,
        alt: image.alt ?? ''
      }))
      .filter((image: AnyObject) => image.thumb && image.fullsize)
  }

  if (Array.isArray(source.items)) {
    return source.items
      .map((image: AnyObject) => ({
        thumb: image.thumbnail ?? image.thumb,
        fullsize: image.fullsize,
        alt: image.alt ?? ''
      }))
      .filter((image: AnyObject) => image.thumb && image.fullsize)
  }

  return []
}

function postUrl(uri: string, handle: string) {
  const parts = uri.split('/')
  const rkey = parts.at(-1)
  return rkey ? `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${rkey}` : 'https://bsky.app'
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

  try {
    const response = await fetch(`${BSKY_SEARCH}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    })

    if (!response.ok) {
      const details = await response.text()
      return NextResponse.json(
        { error: `Bluesky a refusé la recherche (${response.status}).`, details },
        { status: response.status }
      )
    }

    const data = await response.json()
    const results = (data.posts ?? [])
      .map((post: AnyObject) => {
        const images = extractImages(post.embed)
        if (!images.length) return null

        const handle = post.author?.handle ?? post.author?.did ?? 'bsky.app'
        return {
          uri: post.uri,
          cid: post.cid,
          text: post.record?.text ?? '',
          createdAt: post.record?.createdAt ?? post.indexedAt,
          indexedAt: post.indexedAt,
          author: {
            handle,
            displayName: post.author?.displayName ?? handle,
            avatar: post.author?.avatar ?? null
          },
          images,
          postUrl: postUrl(post.uri, handle),
          likeCount: post.likeCount ?? 0,
          repostCount: post.repostCount ?? 0
        }
      })
      .filter(Boolean)

    return NextResponse.json({
      posts: results,
      cursor: data.cursor ?? null,
      hitsTotal: data.hitsTotal ?? null
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Impossible de joindre Bluesky pour le moment.' },
      { status: 502 }
    )
  }
}
