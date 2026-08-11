'use client'

import Hls from 'hls.js'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type Photo={thumb:string;fullsize:string;alt:string}
type Video={playlist:string;thumbnail:string|null;alt:string;aspectRatio:{width:number;height:number}|null}
type Post={uri:string;cid:string;text:string;createdAt:string;author:{handle:string;displayName:string;avatar:string|null};images?:Photo[];video?:Video;likeCount:number;repostCount:number}
type SearchResponse={posts:Post[];cursor:string|null;error?:string}
type DisplayImage={key:string;photo:Photo}
type DisplayVideo={key:string;video:Video}
type DisplayMedia={key:string;kind:'image';photo:Photo}|{key:string;kind:'video';video:Video}
type Mode='search'|'accounts'|'videos'

const AGE_KEY='visual-search-adult-confirmed'
const ACCOUNTS_KEY='visual-search-accounts-v2'
const MAX_ACCOUNTS=20

function shuffle<T>(items:T[]){const copy=[...items];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}return copy}
function uniquePosts(posts:Post[]){const seen=new Set<string>();return posts.filter(post=>{if(seen.has(post.uri))return false;seen.add(post.uri);return true})}
function byLikes(posts:Post[]){return [...posts].sort((a,b)=>(b.likeCount??0)-(a.likeCount??0))}
function imageItems(posts:Post[]):DisplayImage[]{return posts.flatMap(post=>(post.images??[]).map((photo,index)=>({key:`${post.uri}-${index}`,photo})))}
function videoItems(posts:Post[]):DisplayVideo[]{const seen=new Set<string>();return posts.flatMap(post=>{if(!post.video||seen.has(post.video.playlist))return[];seen.add(post.video.playlist);return[{key:post.video.playlist,video:post.video}]})}
function mediaItems(posts:Post[]):DisplayMedia[]{const seenVideos=new Set<string>();return posts.flatMap(post=>{const media:DisplayMedia[]=(post.images??[]).map((photo,index)=>({key:`${post.uri}-image-${index}`,kind:'image' as const,photo}));if(post.video&&!seenVideos.has(post.video.playlist)){seenVideos.add(post.video.playlist);media.push({key:post.video.playlist,kind:'video',video:post.video})}return media})}
function cleanAccount(value:string){return value.trim().replace(/^@+/,'').replace(/[\s,;]+/g,'')}
function freshPosts(existing:Post[],incoming:Post[]){const uris=new Set(existing.map(post=>post.uri));const videos=new Set(existing.flatMap(post=>post.video?[post.video.playlist]:[]));return uniquePosts(incoming).filter(post=>{if(uris.has(post.uri))return false;if(post.video&&videos.has(post.video.playlist))return false;return true})}

function VideoCard({video,mediaKey}:{video:Video;mediaKey:string}){
 const cardRef=useRef<HTMLDivElement|null>(null)
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const [near,setNear]=useState(false)
 const width=video.aspectRatio?.width??9
 const height=video.aspectRatio?.height??16
 const ratio=`${width} / ${height}`
 const orientation=width>height*1.12?'videoLandscape':height>width*1.12?'videoPortrait':'videoSquare'
 const poster=video.thumbnail||video.playlist.replace(/playlist\.m3u8(?:\?.*)?$/,'thumbnail.jpg')

 useEffect(()=>{const node=cardRef.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting){setNear(true);observer.disconnect()}},{rootMargin:'1600px 0px 1600px 0px',threshold:0});observer.observe(node);return()=>observer.disconnect()},[])
 useEffect(()=>{if(!near)return;const el=videoRef.current;if(!el)return;el.preload='auto';if(el.canPlayType('application/vnd.apple.mpegurl')){el.src=video.playlist;el.load();return}if(!Hls.isSupported())return;const hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:20,maxBufferLength:12,startFragPrefetch:true,autoStartLoad:true});hls.loadSource(video.playlist);hls.attachMedia(el);return()=>hls.destroy()},[near,video.playlist])

 return <div ref={cardRef} className={`videoCard ${orientation}`} key={mediaKey} style={{aspectRatio:ratio}}><video ref={videoRef} poster={poster||undefined} controls playsInline preload="none" aria-label={video.alt||'Vidéo'}/><span className="videoMark" aria-hidden="true"/></div>
}

export default function Home(){
 const[query,setQuery]=useState('');const[activeQuery,setActiveQuery]=useState('');const[mode,setMode]=useState<Mode>('search');const[accounts,setAccounts]=useState<string[]>([]);const[posts,setPosts]=useState<Post[]>([]);const[displayImages,setDisplayImages]=useState<DisplayImage[]>([]);const[displayVideos,setDisplayVideos]=useState<DisplayVideo[]>([]);const[displayMedia,setDisplayMedia]=useState<DisplayMedia[]>([]);const[cursor,setCursor]=useState<string|null>(null);const[loading,setLoading]=useState(false);const[failed,setFailed]=useState(false);const[ageChecked,setAgeChecked]=useState(false);const[adultConfirmed,setAdultConfirmed]=useState(false);const infiniteSentinel=useRef<HTMLDivElement|null>(null);const loadingRef=useRef(false);const lastCursorRef=useRef<string|null>(null)
 const accountsQuery=useMemo(()=>accounts.map(a=>`@${a}`).join(','),[accounts])
 useEffect(()=>{try{setAdultConfirmed(localStorage.getItem(AGE_KEY)==='yes');const saved=JSON.parse(localStorage.getItem(ACCOUNTS_KEY)??'[]');if(Array.isArray(saved))setAccounts(saved.filter(x=>typeof x==='string').slice(0,MAX_ACCOUNTS))}catch{setAdultConfirmed(false)}finally{setAgeChecked(true)}},[])
 function saveAccounts(next:string[]){setAccounts(next);try{localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(next))}catch{}}
 function confirmAdult(){try{localStorage.setItem(AGE_KEY,'yes')}catch{}setAdultConfirmed(true)}

 async function fetchFeed(nextQuery:string,nextCursor?:string|null,append=false,nextMode:Mode=mode){
  const cleaned=nextQuery.trim();if(!cleaned||loadingRef.current)return;if(append&&nextCursor&&lastCursorRef.current===nextCursor)return;loadingRef.current=true;if(append&&nextCursor)lastCursorRef.current=nextCursor;setLoading(true);setFailed(false)
  try{
   const endpoint=nextMode==='accounts'?'/api/accounts':nextMode==='videos'?'/api/videos':'/api/search';const params=new URLSearchParams({q:cleaned});if(nextMode==='search'){params.set('sort','latest');params.set('mode','adult')}if(nextCursor)params.set('cursor',nextCursor)
   const response=await fetch(`${endpoint}?${params}`);const data:SearchResponse=await response.json();if(!response.ok)throw new Error(data.error||'search')
   const newPosts=append?freshPosts(posts,data.posts):uniquePosts(data.posts);const combined=uniquePosts(append?[...posts,...newPosts]:newPosts);setPosts(combined)
   if(nextMode==='videos'){
    const fresh=videoItems(newPosts);setDisplayVideos(append?[...displayVideos,...shuffle(fresh)]:videoItems(byLikes(newPosts)));setDisplayImages([]);setDisplayMedia([])
   }else if(nextMode==='accounts'){
    const fresh=mediaItems(newPosts);setDisplayMedia(append?[...displayMedia,...shuffle(fresh)]:mediaItems(byLikes(newPosts)));setDisplayImages([]);setDisplayVideos([])
   }else{
    const fresh=imageItems(newPosts);setDisplayImages(append?[...displayImages,...shuffle(fresh)]:imageItems(byLikes(newPosts)));setDisplayVideos([]);setDisplayMedia([])
   }
   const stalled=append&&nextCursor&&data.cursor===nextCursor
   setCursor(stalled?null:data.cursor);if(!stalled)lastCursorRef.current=null;setActiveQuery(cleaned)
  }catch{setFailed(true);lastCursorRef.current=null;if(!append){setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null)}}finally{loadingRef.current=false;setLoading(false)}
 }

 useEffect(()=>{const target=infiniteSentinel.current;if(!target||!cursor||!activeQuery)return;const observer=new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting||loadingRef.current)return;const q=mode==='accounts'?accountsQuery:activeQuery;if(q)fetchFeed(q,cursor,true,mode)},{rootMargin:'2400px 0px 2400px 0px',threshold:0});observer.observe(target);return()=>observer.disconnect()},[cursor,activeQuery,mode,accountsQuery,posts,displayVideos,displayImages,displayMedia])
 function submit(e:FormEvent){e.preventDefault();lastCursorRef.current=null;if(mode==='accounts'){const account=cleanAccount(query);if(!account||accounts.includes(account)||accounts.length>=MAX_ACCOUNTS)return;const next=[...accounts,account];saveAccounts(next);setQuery('');fetchFeed(next.map(x=>`@${x}`).join(','),null,false,'accounts');return}fetchFeed(query)}
 function switchMode(nextMode:Mode){if(nextMode===mode||loadingRef.current)return;lastCursorRef.current=null;setMode(nextMode);setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null);setActiveQuery('');setFailed(false);setQuery('');if(nextMode==='accounts'&&accounts.length)setTimeout(()=>fetchFeed(accounts.map(x=>`@${x}`).join(','),null,false,'accounts'),0)}
 function removeAccount(account:string){const next=accounts.filter(x=>x!==account);saveAccounts(next);lastCursorRef.current=null;setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null);setActiveQuery('');if(next.length)setTimeout(()=>fetchFeed(next.map(x=>`@${x}`).join(','),null,false,'accounts'),0)}
 const hasResults=mode==='videos'?displayVideos.length>0:mode==='accounts'?displayMedia.length>0:displayImages.length>0

 return <main className="adultMode">
  {ageChecked&&!adultConfirmed&&<div className="ageGate" role="dialog" aria-modal="true" aria-labelledby="ageGateTitle"><div className="ageGateGlow" aria-hidden="true"/><div className="ageGateCard"><div className="ageMark" aria-hidden="true">18+</div><h1 id="ageGateTitle">Accès réservé aux adultes</h1><p>Je certifie avoir au moins 18 ans et être autorisé à consulter du contenu pour adultes dans mon pays.</p><button className="ageConfirm" type="button" onClick={confirmAdult}>J’ai 18 ans ou plus</button><a className="ageExit" href="https://bsky.app">Je suis mineur</a></div></div>}
  <section className="hero"><div className="topLine"><div className="eyebrow">Recherche visuelle</div><div className="modeTabs" role="tablist" aria-label="Mode">
   <button className={mode==='search'?'active adultTab':'adultTab'} type="button" role="tab" aria-selected={mode==='search'} aria-label="Recherche photo" onClick={()=>switchMode('search')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 2.8c.4 3.2-1.2 4.6-2.5 6.2-1.1 1.4-2 2.7-1.2 4.6.5 1.1 1.4 1.8 2.5 2.1-.1-2.1 1-3.4 2.5-4.9 2.2 1.8 3.8 4 3.8 6.6A6.7 6.7 0 0 1 12 24a6.8 6.8 0 0 1-6.8-6.7c0-4.8 3.5-7.5 5.6-10.2 1.1-1.4 2-2.7 2.9-4.3Z"/></svg></button>
   <button className={mode==='videos'?'active videoTab':'videoTab'} type="button" role="tab" aria-selected={mode==='videos'} aria-label="Recherche vidéo" onClick={()=>switchMode('videos')}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path className="videoPlay" d="m10 9 5 3-5 3Z"/></svg></button>
   <button className={mode==='accounts'?'active accountsTab':'accountsTab'} type="button" role="tab" aria-selected={mode==='accounts'} aria-label="Comptes" onClick={()=>switchMode('accounts')}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.8 18.5c.7-3 2.5-4.7 5.2-4.7s4.5 1.7 5.2 4.7"/><circle cx="17" cy="9" r="2.4"/><path d="M14.8 14.2c2.8-.6 4.8.7 5.4 3.3"/></svg></button>
  </div></div>
  <form className={`search ${failed?'failed':''}`} onSubmit={submit}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={mode==='accounts'?'@compte…':'Rechercher…'} aria-label={mode==='accounts'?'Ajouter un compte':mode==='videos'?'Recherche vidéo':'Recherche'} autoComplete="off" spellCheck={false}/><button className={loading?'loading':''} type="submit" disabled={loading||!query.trim()||(mode==='accounts'&&accounts.length>=MAX_ACCOUNTS)} aria-label="Lancer"><span className="searchGlyph" aria-hidden="true"/></button></form>
  {mode==='accounts'&&accounts.length>0&&<div className="accountRail" aria-label="Comptes suivis">{accounts.map(account=><button className="accountChip" key={account} type="button" onClick={()=>removeAccount(account)} aria-label={`Retirer ${account}`}><span>@{account}</span><i aria-hidden="true">×</i></button>)}<span className="accountCount">{accounts.length}/{MAX_ACCOUNTS}</span></div>}
  </section>
  {(hasResults||(cursor&&activeQuery))&&<section className="resultsSection" aria-label="Résultats">
   {mode==='videos'&&displayVideos.length>0?<div className="videoGrid">{displayVideos.map(({key,video})=><VideoCard key={key} mediaKey={key} video={video}/>)}</div>:mode==='accounts'&&displayMedia.length>0?<div className="mixedGrid">{displayMedia.map(media=>media.kind==='image'?<a className="imageCard" href={media.photo.fullsize} target="_blank" rel="noreferrer" key={media.key} aria-label="Ouvrir l’image"><img src={media.photo.thumb||media.photo.fullsize} alt="" loading="lazy"/></a>:<VideoCard key={media.key} mediaKey={media.key} video={media.video}/>)}</div>:displayImages.length>0?<div className="grid">{displayImages.map(({key,photo})=><a className="imageCard" href={photo.fullsize} target="_blank" rel="noreferrer" key={key} aria-label="Ouvrir l’image"><img src={photo.thumb||photo.fullsize} alt="" loading="lazy"/></a>)}</div>:null}
   {cursor&&activeQuery&&<div className={`infiniteSentinel ${loading?'loading':''}`} ref={infiniteSentinel} aria-hidden="true"><span/></div>}
  </section>}
 </main>
}
