'use client'

import { FormEvent, useMemo, useState } from 'react'
import JSZip from 'jszip'

type Photo = { thumb: string; fullsize: string; alt: string }
type Post = {
  uri: string
  cid: string
  text: string
  createdAt: string
  author: { handle: string; displayName: string; avatar: string | null }
  images: Photo[]
  postUrl: string
  likeCount: number
  repostCount: number
}

type SearchResponse = {
  posts: Post[]
  cursor: string | null
  hitsTotal: number | null
  error?: string
}

const EXAMPLES = ['chat roux à poils longs', 'aurores boréales', 'voiture ancienne', 'street photography']

function safeName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'photo'
}

function extension(contentType: string | null) {
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('gif')) return 'gif'
  return 'jpg'
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sort, setSort] = useState<'latest' | 'top'>('latest')
  const [posts, setPosts] = useState<Post[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hitsTotal, setHitsTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  const imageCount = useMemo(() => posts.reduce((sum, post) => sum + post.images.length, 0), [posts])

  async function runSearch(nextQuery: string, nextCursor?: string | null, append = false, nextSort = sort) {
    const cleaned = nextQuery.trim()
    if (!cleaned) return

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ q: cleaned, sort: nextSort })
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()
      if (!response.ok) throw new Error(data.error || 'La recherche a échoué.')

      setPosts(previous => append ? [...previous, ...data.posts] : data.posts)
      setCursor(data.cursor)
      setHitsTotal(data.hitsTotal)
      setActiveQuery(cleaned)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    runSearch(query)
  }

  function changeSort(value: 'latest' | 'top') {
    setSort(value)
    if (activeQuery) runSearch(activeQuery, null, false, value)
  }

  async function fetchImage(url: string) {
    const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`)
    if (!response.ok) throw new Error('Téléchargement impossible.')
    return response
  }

  async function downloadOne(photo: Photo, post: Post, index: number) {
    try {
      const response = await fetchImage(photo.fullsize)
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `${safeName(post.author.handle)}-${index + 1}.${extension(response.headers.get('content-type'))}`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch {
      setError('Impossible de télécharger cette image.')
    }
  }

  async function downloadAll() {
    if (!imageCount || downloading) return
    setDownloading(true)
    setError('')

    try {
      const zip = new JSZip()
      let number = 1
      for (const post of posts) {
        for (const photo of post.images) {
          const response = await fetchImage(photo.fullsize)
          const blob = await response.blob()
          const ext = extension(response.headers.get('content-type'))
          zip.file(`${String(number).padStart(3, '0')}-${safeName(post.author.handle)}.${ext}`, blob)
          number += 1
        }
      }
      const archive = await zip.generateAsync({ type: 'blob' })
      const href = URL.createObjectURL(archive)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `${safeName(activeQuery)}-photos.zip`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch {
      setError('Le téléchargement groupé a échoué.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">Recherche visuelle</div>
        <h1>Retrouve les photos<br />partagées publiquement.</h1>
        <p className="intro">Tape des mots-clés. L’application parcourt des publications publiques correspondantes et ne conserve que celles qui contiennent des images.</p>

        <form className="search" onSubmit={submit}>
          <span className="searchIcon" aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Ex. chat roux à poils longs"
            aria-label="Mots-clés de recherche"
          />
          <button type="submit" disabled={loading || !query.trim()}>{loading ? 'Recherche…' : 'Rechercher'}</button>
        </form>

        <div className="examples">
          <span>Essayer :</span>
          {EXAMPLES.map(example => (
            <button key={example} onClick={() => { setQuery(example); runSearch(example) }}>{example}</button>
          ))}
        </div>
      </section>

      {(activeQuery || error) && (
        <section className="resultsSection">
          <div className="toolbar">
            <div>
              <div className="resultTitle">{activeQuery ? `“${activeQuery}”` : 'Résultats'}</div>
              <div className="resultMeta">
                {loading && !posts.length ? 'Recherche en cours…' : `${posts.length} publications · ${imageCount} photos${hitsTotal ? ` · ${hitsTotal.toLocaleString('fr-FR')} résultats` : ''}`}
              </div>
            </div>
            <div className="actions">
              <div className="segmented" aria-label="Tri">
                <button className={sort === 'latest' ? 'active' : ''} onClick={() => changeSort('latest')}>Récent</button>
                <button className={sort === 'top' ? 'active' : ''} onClick={() => changeSort('top')}>Populaire</button>
              </div>
              <button className="downloadAll" onClick={downloadAll} disabled={!imageCount || downloading}>
                {downloading ? 'Création du ZIP…' : `Télécharger tout (${imageCount})`}
              </button>
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          {!loading && activeQuery && posts.length === 0 && !error && (
            <div className="empty"><strong>Aucune photo trouvée.</strong><span>Essaie des termes plus larges ou une autre formulation.</span></div>
          )}

          <div className="grid">
            {posts.flatMap(post => post.images.map((photo, index) => (
              <article className="card" key={`${post.uri}-${index}`}>
                <a className="imageWrap" href={post.postUrl} target="_blank" rel="noreferrer">
                  <img src={photo.thumb || photo.fullsize} alt={photo.alt || post.text || 'Photo'} loading="lazy" />
                  {post.images.length > 1 && <span className="count">{index + 1}/{post.images.length}</span>}
                </a>
                <div className="cardBody">
                  <div className="authorRow">
                    {post.author.avatar ? <img className="avatar" src={post.author.avatar} alt="" /> : <div className="avatar fallback" />}
                    <div className="author"><strong>{post.author.displayName}</strong><span>@{post.author.handle}</span></div>
                    <button className="iconButton" onClick={() => downloadOne(photo, post, index)} title="Télécharger la photo" aria-label="Télécharger la photo">↓</button>
                  </div>
                  {post.text && <p className="caption">{post.text}</p>}
                  <div className="cardFooter">
                    <span>{new Date(post.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    <a href={post.postUrl} target="_blank" rel="noreferrer">Voir la publication ↗</a>
                  </div>
                </div>
              </article>
            )))}
          </div>

          {cursor && posts.length > 0 && (
            <div className="moreWrap">
              <button className="more" onClick={() => runSearch(activeQuery, cursor, true)} disabled={loading}>
                {loading ? 'Chargement…' : 'Charger plus de résultats'}
              </button>
            </div>
          )}
        </section>
      )}

      <footer>Photos issues de publications publiques · Aucune connexion requise</footer>
    </main>
  )
}
