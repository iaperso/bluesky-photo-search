'use client'

import { FormEvent, useEffect, useState } from 'react'

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

type Mode = 'all' | 'adult'
type DisplayImage = { key: string; photo: Photo }

const AGE_KEY = 'visual-search-adult-confirmed'

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }
  return copy
}

function uniquePosts(posts: Post[]) {
  const seen = new Set<string>()
  return posts.filter(post => {
    if (seen.has(post.uri)) return false
    seen.add(post.uri)
    return true
  })
}

function randomizedImages(posts: Post[]) {
  return shuffle(
    posts.flatMap(post =>
      post.images.map((photo, index) => ({
        key: `${post.uri}-${index}`,
        photo
      }))
    )
  )
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [mode, setMode] = useState<Mode>('all')
  const [posts, setPosts] = useState<Post[]>([])
  const [displayImages, setDisplayImages] = useState<DisplayImage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ageChecked, setAgeChecked] = useState(false)
  const [adultConfirmed, setAdultConfirmed] = useState(false)

  useEffect(() => {
    try {
      setAdultConfirmed(window.localStorage.getItem(AGE_KEY) === 'yes')
    } catch {
      setAdultConfirmed(false)
    } finally {
      setAgeChecked(true)
    }
  }, [])

  function confirmAdult() {
    try {
      window.localStorage.setItem(AGE_KEY, 'yes')
    } catch {}
    setAdultConfirmed(true)
  }

  async function runSearch(nextQuery: string, nextCursor?: string | null, append = false, nextMode: Mode = mode) {
    const cleaned = nextQuery.trim()
    if (!cleaned || loading) return

    setLoading(true)
    setFailed(false)

    try {
      const params = new URLSearchParams({ q: cleaned, sort: 'latest', mode: nextMode })
      if (nextCursor) params.set('cursor', nextCursor)

      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()
      if (!response.ok) throw new Error(data.error || 'search')

      const combined = append ? [...posts, ...data.posts] : data.posts
      const deduplicated = uniquePosts(combined)

      setPosts(deduplicated)
      setDisplayImages(randomizedImages(deduplicated))
      setCursor(data.cursor)
      setActiveQuery(cleaned)
    } catch {
      setFailed(true)
      if (!append) {
        setPosts([])
        setDisplayImages([])
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

  function switchMode(nextMode: Mode) {
    if (nextMode === mode || loading) return
    setMode(nextMode)
    setFailed(false)
    setPosts([])
    setDisplayImages([])
    setCursor(null)
    if (activeQuery) runSearch(activeQuery, null, false, nextMode)
  }

  return (
    <main className={mode === 'adult' ? 'adultMode' : ''}>
      {ageChecked && !adultConfirmed && (
        <div className="ageGate" role="dialog" aria-modal="true" aria-labelledby="ageGateTitle">
          <div className="ageGateGlow" aria-hidden="true" />
          <div className="ageGateCard">
            <div className="ageMark" aria-hidden="true">18+</div>
            <h1 id="ageGateTitle">Accès réservé aux adultes</h1>
            <p>Je certifie avoir au moins 18 ans et être autorisé à consulter du contenu pour adultes dans mon pays.</p>
            <button className="ageConfirm" type="button" onClick={confirmAdult}>J’ai 18 ans ou plus</button>
            <a className="ageExit" href="https://bsky.app">Je suis mineur</a>
          </div>
        </div>
      )}

      <section className="hero">
        <div className="topLine">
          <div className="eyebrow">Recherche visuelle</div>
          <div className="modeTabs" role="tablist" aria-label="Mode de recherche">
            <button
              className={mode === 'all' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'all'}
              aria-label="Recherche générale"
              onClick={() => switchMode('all')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="5.5" />
                <path d="M14.7 14.7 20 20" />
              </svg>
            </button>
            <button
              className={mode === 'adult' ? 'active adultTab' : 'adultTab'}
              type="button"
              role="tab"
              aria-selected={mode === 'adult'}
              aria-label="Contenu adulte uniquement"
              onClick={() => switchMode('adult')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13.7 2.8c.4 3.2-1.2 4.6-2.5 6.2-1.1 1.4-2 2.7-1.2 4.6.5 1.1 1.4 1.8 2.5 2.1-.1-2.1 1-3.4 2.5-4.9 2.2 1.8 3.8 4 3.8 6.6A6.7 6.7 0 0 1 12 24a6.8 6.8 0 0 1-6.8-6.7c0-4.8 3.5-7.5 5.6-10.2 1.1-1.4 2-2.7 2.9-4.3Z" />
              </svg>
            </button>
          </div>
        </div>

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

      {(displayImages.length > 0 || (cursor && activeQuery)) && (
        <section className="resultsSection" aria-label="Résultats">
          {displayImages.length > 0 && (
            <div className="grid">
              {displayImages.map(({ key, photo }) => (
                <a
                  className="imageCard"
                  href={photo.fullsize}
                  target="_blank"
                  rel="noreferrer"
                  key={key}
                  aria-label="Ouvrir l’image"
                >
                  <img src={photo.thumb || photo.fullsize} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          )}

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
