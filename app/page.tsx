'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

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

type DisplayImage = { key: string; photo: Photo }
type Mode = 'search' | 'accounts'

const AGE_KEY = 'visual-search-adult-confirmed'
const ACCOUNTS_KEY = 'visual-search-accounts-v2'
const MAX_ACCOUNTS = 20

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

function cleanAccount(value: string) {
  return value.trim().replace(/^@+/, '').replace(/[\s,;]+/g, '')
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [mode, setMode] = useState<Mode>('search')
  const [accounts, setAccounts] = useState<string[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [displayImages, setDisplayImages] = useState<DisplayImage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ageChecked, setAgeChecked] = useState(false)
  const [adultConfirmed, setAdultConfirmed] = useState(false)

  const accountsQuery = useMemo(() => accounts.map(account => `@${account}`).join(','), [accounts])

  useEffect(() => {
    try {
      setAdultConfirmed(window.localStorage.getItem(AGE_KEY) === 'yes')
      const saved = JSON.parse(window.localStorage.getItem(ACCOUNTS_KEY) ?? '[]')
      if (Array.isArray(saved)) {
        setAccounts(saved.filter(item => typeof item === 'string').slice(0, MAX_ACCOUNTS))
      }
    } catch {
      setAdultConfirmed(false)
    } finally {
      setAgeChecked(true)
    }
  }, [])

  function saveAccounts(next: string[]) {
    setAccounts(next)
    try { window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next)) } catch {}
  }

  function confirmAdult() {
    try { window.localStorage.setItem(AGE_KEY, 'yes') } catch {}
    setAdultConfirmed(true)
  }

  async function fetchFeed(nextQuery: string, nextCursor?: string | null, append = false, nextMode: Mode = mode) {
    const cleaned = nextQuery.trim()
    if (!cleaned || loading) return

    setLoading(true)
    setFailed(false)

    try {
      const endpoint = nextMode === 'accounts' ? '/api/accounts' : '/api/search'
      const params = new URLSearchParams({ q: cleaned })
      if (nextMode === 'search') {
        params.set('sort', 'latest')
        params.set('mode', 'adult')
      }
      if (nextCursor) params.set('cursor', nextCursor)

      const response = await fetch(`${endpoint}?${params.toString()}`)
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
    if (mode === 'accounts') {
      const account = cleanAccount(query)
      if (!account || accounts.includes(account) || accounts.length >= MAX_ACCOUNTS) return
      const next = [...accounts, account]
      saveAccounts(next)
      setQuery('')
      fetchFeed(next.map(item => `@${item}`).join(','), null, false, 'accounts')
      return
    }
    fetchFeed(query)
  }

  function switchMode(nextMode: Mode) {
    if (nextMode === mode || loading) return
    setMode(nextMode)
    setPosts([])
    setDisplayImages([])
    setCursor(null)
    setActiveQuery('')
    setFailed(false)
    setQuery('')

    if (nextMode === 'accounts' && accounts.length) {
      setTimeout(() => fetchFeed(accounts.map(item => `@${item}`).join(','), null, false, 'accounts'), 0)
    }
  }

  function removeAccount(account: string) {
    const next = accounts.filter(item => item !== account)
    saveAccounts(next)
    setPosts([])
    setDisplayImages([])
    setCursor(null)
    setActiveQuery('')
    if (next.length) {
      setTimeout(() => fetchFeed(next.map(item => `@${item}`).join(','), null, false, 'accounts'), 0)
    }
  }

  return (
    <main className="adultMode">
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
          <div className="modeTabs" role="tablist" aria-label="Mode">
            <button className={mode === 'search' ? 'active adultTab' : 'adultTab'} type="button" role="tab" aria-selected={mode === 'search'} aria-label="Recherche" onClick={() => switchMode('search')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 2.8c.4 3.2-1.2 4.6-2.5 6.2-1.1 1.4-2 2.7-1.2 4.6.5 1.1 1.4 1.8 2.5 2.1-.1-2.1 1-3.4 2.5-4.9 2.2 1.8 3.8 4 3.8 6.6A6.7 6.7 0 0 1 12 24a6.8 6.8 0 0 1-6.8-6.7c0-4.8 3.5-7.5 5.6-10.2 1.1-1.4 2-2.7 2.9-4.3Z" /></svg>
            </button>
            <button className={mode === 'accounts' ? 'active accountsTab' : 'accountsTab'} type="button" role="tab" aria-selected={mode === 'accounts'} aria-label="Comptes" onClick={() => switchMode('accounts')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.8 18.5c.7-3 2.5-4.7 5.2-4.7s4.5 1.7 5.2 4.7" /><circle cx="17" cy="9" r="2.4" /><path d="M14.8 14.2c2.8-.6 4.8.7 5.4 3.3" /></svg>
            </button>
          </div>
        </div>

        <form className={`search ${failed ? 'failed' : ''}`} onSubmit={submit}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'accounts' ? '@compte…' : 'Rechercher…'} aria-label={mode === 'accounts' ? 'Ajouter un compte' : 'Recherche'} autoComplete="off" spellCheck={false} />
          <button className={loading ? 'loading' : ''} type="submit" disabled={loading || !query.trim() || (mode === 'accounts' && accounts.length >= MAX_ACCOUNTS)} aria-label="Lancer">
            <span className="searchGlyph" aria-hidden="true" />
          </button>
        </form>

        {mode === 'accounts' && accounts.length > 0 && (
          <div className="accountRail" aria-label="Comptes suivis">
            {accounts.map(account => (
              <button className="accountChip" key={account} type="button" onClick={() => removeAccount(account)} aria-label={`Retirer ${account}`}>
                <span>@{account}</span><i aria-hidden="true">×</i>
              </button>
            ))}
            <span className="accountCount">{accounts.length}/{MAX_ACCOUNTS}</span>
          </div>
        )}
      </section>

      {(displayImages.length > 0 || (cursor && activeQuery)) && (
        <section className="resultsSection" aria-label="Résultats">
          {displayImages.length > 0 && (
            <div className="grid">
              {displayImages.map(({ key, photo }) => (
                <a className="imageCard" href={photo.fullsize} target="_blank" rel="noreferrer" key={key} aria-label="Ouvrir l’image">
                  <img src={photo.thumb || photo.fullsize} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          )}

          {cursor && activeQuery && (
            <div className="moreWrap">
              <button className={`moreButton ${loading ? 'loading' : ''}`} onClick={() => fetchFeed(mode === 'accounts' ? accountsQuery : activeQuery, cursor, true)} disabled={loading} aria-label="Charger plus">
                <span aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
