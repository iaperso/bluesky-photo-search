'use client'

import { FormEvent, useState } from 'react'

type Photo = { thumb: string; fullsize: string; alt: string }
type Post = {
  uri: string
  cid: string
  text: string
  createdAt: string
  author: { handle: string; displayName: string; avatar: string | null }
  images: Photo[]
  likeCount: number
  repostCount: number
}

type SearchResponse = {
  posts: Post[]
  cursor: string | null
  error?: string
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [posts, setPosts] = useState<Post[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function runSearch(nextQuery: string, nextCursor?: string | null, append = false) {
    const cleaned = nextQuery.trim()
    if (!cleaned || loading) return

    setLoading(true)
    setFailed(false)

    try {
      const params = new URLSearchParams({ q: cleaned, sort: 'latest' })
      if (nextCursor) params.set('cursor', nextCursor)

      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()
      if (!response.ok) throw new Error(data.error || 'search')

      setPosts(previous => append ? [...previous, ...data.posts] : data.posts)
      setCursor(data.cursor)
      setActiveQuery(cleaned)
    } catch {
      setFailed(true)
      if (!append) {
        setPosts([])
        setCursor(null)
      }
    } finally {
      setLoading(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    runSearch(query)
  }

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">Recherche visuelle</div>
        <form className={`search ${failed ? 'failed' : ''}`} onSubmit={submit}>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Rechercher…"
            aria-label="Recherche"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className={loading ? 'loading' : ''}
            type="submit"
            disabled={loading || !query.trim()}
            aria-label="Lancer la recherche"
          >
            <span className="searchGlyph" aria-hidden="true" />
          </button>
        </form>
      </section>

      {posts.length > 0 && (
        <section className="resultsSection" aria-label="Résultats">
          <div className="grid">
            {posts.flatMap(post => post.images.map((photo, index) => (
              <a
                className="imageCard"
                href={photo.fullsize}
                target="_blank"
                rel="noreferrer"
                key={`${post.uri}-${index}`}
                aria-label="Ouvrir l’image"
              >
                <img src={photo.thumb || photo.fullsize} alt="" loading="lazy" />
              </a>
            )))}
          </div>

          {cursor && activeQuery && (
            <div className="moreWrap">
              <button
                className={`moreButton ${loading ? 'loading' : ''}`}
                onClick={() => runSearch(activeQuery, cursor, true)}
                disabled={loading}
                aria-label="Charger plus"
              >
                <span aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
