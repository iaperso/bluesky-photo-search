'use client'

import Hls from 'hls.js'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type Photo={thumb:string;fullsize:string;alt:string}
type Video={playlist:string;thumbnail:string|null;alt:string;aspectRatio:{width:number;height:number}|null}
type Post={uri:string;cid:string;text:string;createdAt:string;author:{handle:string;displayName:string;avatar:string|null};images?:Photo[];video?:Video;likeCount:number;repostCount:number}
type SearchResponse={posts:Post[];cursor:string|null;error?:string}
type DisplayImage={key:string;photo:Photo;author:string}
type DisplayVideo={key:string;video:Video;author:string}
type DisplayMedia={key:string;kind:'image';photo:Photo;author:string}|{key:string;kind:'video';video:Video;author:string}
type Mode='search'|'accounts'|'videos'

const AGE_KEY='visual-search-adult-confirmed'
const ACCOUNTS_KEY='visual-search-accounts-v2'
const MAX_ACCOUNTS=20
const DISCOVERY_QUERY='__discovery__'

function shuffle<T>(items:T[]){const copy=[...items];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}return copy}
function uniquePosts(posts:Post[]){const seen=new Set<string>();return posts.filter(post=>{if(seen.has(post.uri))return false;seen.add(post.uri);return true})}
function byLikes(posts:Post[]){return [...posts].sort((a,b)=>(b.likeCount??0)-(a.likeCount??0))}
function imageItems(posts:Post[]):DisplayImage[]{return posts.flatMap(post=>(post.images??[]).map((photo,index)=>({key:`${post.uri}-${index}`,photo,author:post.author.handle})))}
function videoItems(posts:Post[]):DisplayVideo[]{const seen=new Set<string>();return posts.flatMap(post=>{if(!post.video||seen.has(post.video.playlist))return[];seen.add(post.video.playlist);return[{key:post.video.playlist,video:post.video,author:post.author.handle}]})}
function mediaItems(posts:Post[]):DisplayMedia[]{const seenVideos=new Set<string>();return posts.flatMap(post=>{const media:DisplayMedia[]=(post.images??[]).map((photo,index)=>({key:`${post.uri}-image-${index}`,kind:'image' as const,photo,author:post.author.handle}));if(post.video&&!seenVideos.has(post.video.playlist)){seenVideos.add(post.video.playlist);media.push({key:post.video.playlist,kind:'video',video:post.video,author:post.author.handle})}return media})}
function cleanAccount(value:string){return value.trim().replace(/^@+/,'').replace(/[\s,;]+/g,'')}
function freshPosts(existing:Post[],incoming:Post[]){const uris=new Set(existing.map(post=>post.uri));const videos=new Set(existing.flatMap(post=>post.video?[post.video.playlist]:[]));return uniquePosts(incoming).filter(post=>{if(uris.has(post.uri))return false;if(post.video&&videos.has(post.video.playlist))return false;return true})}
function blendPersonalized(primary:Post[],discovery:Post[]){const main=uniquePosts(primary);const extra=uniquePosts(discovery).filter(post=>!main.some(item=>item.uri===post.uri));if(!extra.length)return main;const mixed:Post[]=[];let e=0;for(let i=0;i<main.length;i++){mixed.push(main[i]);if((i+1)%4===0&&e<extra.length)mixed.push(extra[e++])}return uniquePosts([...mixed,...extra.slice(e,Math.min(e+3,extra.length))])}

function VideoCard({video,mediaKey,author}:{video:Video;mediaKey:string;author:string}){
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const hlsRef=useRef<Hls|null>(null)
 const[started,setStarted]=useState(false)
 const[ready,setReady]=useState(false)
 const[failed,setFailed]=useState(false)
 const width=video.aspectRatio?.width??9
 const height=video.aspectRatio?.height??16
 const ratio=`${width} / ${height}`
 const orientation=width>height*1.12?'videoLandscape':height>width*1.12?'videoPortrait':'videoSquare'

 useEffect(()=>{
  if(!started)return
  const el=videoRef.current
  if(!el)return
  setFailed(false)
  const onReady=()=>setReady(true)
  const onError=()=>{setFailed(true);setReady(false)}
  el.addEventListener('loadeddata',onReady)
  el.addEventListener('canplay',onReady)
  el.addEventListener('error',onError)
  if(el.canPlayType('application/vnd.apple.mpegurl')){if(el.src!==video.playlist)el.src=video.playlist;el.preload='auto';el.load()}
  else if(Hls.isSupported()){const hls=new Hls({enableWorker:true,lowLatencyMode:false,backBufferLength:20,maxBufferLength:20,startFragPrefetch:true,autoStartLoad:true});hlsRef.current=hls;hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal){setFailed(true);setReady(false)}});hls.loadSource(video.playlist);hls.attachMedia(el)}
  return()=>{el.removeEventListener('loadeddata',onReady);el.removeEventListener('canplay',onReady);el.removeEventListener('error',onError);if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}}
 },[started,video.playlist])

 async function startPlayback(){if(!started){setStarted(true);requestAnimationFrame(()=>videoRef.current?.play().catch(()=>{}));return}if(failed){setFailed(false);setReady(false);const el=videoRef.current;if(el){el.src=video.playlist;el.load();el.play().catch(()=>{})}}}

 return <div className={`videoCard mediaViewerItem ${orientation} ${started?'videoStarted':''} ${failed?'videoFailed':''}`} key={mediaKey} style={{aspectRatio:ratio}} data-media-kind="video" data-media-src={video.playlist} data-media-poster={video.thumbnail??''} data-media-author={author} data-video-src={video.playlist} data-video-poster={video.thumbnail??''}>
  <video ref={videoRef} controls={started} playsInline preload="none" aria-label={video.alt||'Vidéo'} onPlay={()=>setReady(true)}/>
  {!ready&&video.thumbnail&&<img className="videoPoster" src={video.thumbnail} alt="" loading="eager" decoding="async"/>}
  {!ready&&<button className="videoStart" type="button" onClick={startPlayback} aria-label={failed?'Réessayer la vidéo':'Lire la vidéo'}><span/></button>}
  <span className="videoMark" aria-hidden="true"/>
 </div>
}

export default function Home(){
 const[query,setQuery]=useState('');const[activeQuery,setActiveQuery]=useState('');const[mode,setMode]=useState<Mode>('search');const[accounts,setAccounts]=useState<string[]>([]);const[posts,setPosts]=useState<Post[]>([]);const[displayImages,setDisplayImages]=useState<DisplayImage[]>([]);const[displayVideos,setDisplayVideos]=useState<DisplayVideo[]>([]);const[displayMedia,setDisplayMedia]=useState<DisplayMedia[]>([]);const[cursor,setCursor]=useState<string|null>(null);const[loading,setLoading]=useState(false);const[failed,setFailed]=useState(false);const[ageChecked,setAgeChecked]=useState(false);const[adultConfirmed,setAdultConfirmed]=useState(false);const infiniteSentinel=useRef<HTMLDivElement|null>(null);const loadingRef=useRef(false);const lastCursorRef=useRef<string|null>(null)
 const accountsQuery=useMemo(()=>accounts.map(a=>`@${a}`).join(','),[accounts])
 const seedQuery=useMemo(()=>accounts.join(','),[accounts])

 useEffect(()=>{try{setAdultConfirmed(localStorage.getItem(AGE_KEY)==='yes');const saved=JSON.parse(localStorage.getItem(ACCOUNTS_KEY)??'[]');if(Array.isArray(saved))setAccounts(saved.filter(x=>typeof x==='string').slice(0,MAX_ACCOUNTS))}catch{setAdultConfirmed(false)}finally{setAgeChecked(true)}},[])
 useEffect(()=>{const onChanged=(event:Event)=>{const detail=(event as CustomEvent).detail;if(Array.isArray(detail))setAccounts(detail.filter(x=>typeof x==='string').slice(0,MAX_ACCOUNTS))};window.addEventListener('visual-search-accounts-changed',onChanged);return()=>window.removeEventListener('visual-search-accounts-changed',onChanged)},[])
 function saveAccounts(next:string[]){setAccounts(next);try{localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(next))}catch{}}
 function confirmAdult(){try{localStorage.setItem(AGE_KEY,'yes')}catch{}setAdultConfirmed(true)}

 async function fetchDiscovery(nextMode:Mode){
  if(nextMode==='accounts'||(nextMode!=='videos'&&!seedQuery))return {posts:[] as Post[],cursor:null,hitsTotal:null}
  const params=new URLSearchParams({kind:nextMode==='videos'?'video':'image'})
  if(seedQuery)params.set('seeds',seedQuery)
  const response=await fetch(`/api/discover?${params}`)
  if(!response.ok)return {posts:[] as Post[],cursor:null,hitsTotal:null}
  return await response.json() as SearchResponse
 }

 async function fetchFeed(nextQuery:string,nextCursor?:string|null,append=false,nextMode:Mode=mode,discoveryOnly=false){
  const cleaned=nextQuery.trim();if(loadingRef.current)return;if(nextMode==='accounts'&&!cleaned)return;if(!cleaned&&nextMode!=='accounts'&&!seedQuery&&nextMode!=='videos')return;if(append&&nextCursor&&lastCursorRef.current===nextCursor)return;loadingRef.current=true;if(append&&nextCursor)lastCursorRef.current=nextCursor;setLoading(true);setFailed(false)
  try{
   let data:SearchResponse
   if(discoveryOnly||(!cleaned&&nextMode!=='accounts')) data=await fetchDiscovery(nextMode)
   else{
    const endpoint=nextMode==='accounts'?'/api/accounts':nextMode==='videos'?'/api/videos':'/api/search'
    const params=new URLSearchParams({q:cleaned});if(nextMode==='search'){params.set('sort','latest');params.set('mode','adult')}if(nextCursor)params.set('cursor',nextCursor)
    const response=await fetch(`${endpoint}?${params}`);const primary:SearchResponse=await response.json();if(!response.ok)throw new Error(primary.error||'search')
    if(!append&&nextMode!=='accounts'&&seedQuery){const personalized=await fetchDiscovery(nextMode);data={...primary,posts:blendPersonalized(primary.posts,personalized.posts)}}else data=primary
   }
   const newPosts=append?freshPosts(posts,data.posts):uniquePosts(data.posts);const combined=uniquePosts(append?[...posts,...newPosts]:newPosts);setPosts(combined)
   if(nextMode==='videos'){const fresh=videoItems(newPosts);setDisplayVideos(append?[...displayVideos,...shuffle(fresh)]:discoveryOnly||!cleaned?shuffle(videoItems(newPosts)):videoItems(byLikes(newPosts)));setDisplayImages([]);setDisplayMedia([])}
   else if(nextMode==='accounts'){const fresh=mediaItems(newPosts);setDisplayMedia(append?[...displayMedia,...shuffle(fresh)]:mediaItems(byLikes(newPosts)));setDisplayImages([]);setDisplayVideos([])}
   else{const fresh=imageItems(newPosts);setDisplayImages(append?[...displayImages,...shuffle(fresh)]:discoveryOnly||!cleaned?shuffle(imageItems(newPosts)):imageItems(byLikes(newPosts)));setDisplayVideos([]);setDisplayMedia([])}
   const stalled=append&&nextCursor&&data.cursor===nextCursor;setCursor(stalled?null:data.cursor);if(!stalled)lastCursorRef.current=null;setActiveQuery(cleaned||DISCOVERY_QUERY)
  }catch{setFailed(true);lastCursorRef.current=null;if(!append){setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null)}}finally{loadingRef.current=false;setLoading(false)}
 }

 useEffect(()=>{if(!ageChecked||mode==='accounts'||activeQuery||loadingRef.current)return;if(mode!=='videos'&&!accounts.length)return;void fetchFeed('',null,false,mode,true)},[ageChecked,accounts.length,mode,activeQuery])
 useEffect(()=>{const target=infiniteSentinel.current;if(!target||!cursor||!activeQuery||activeQuery===DISCOVERY_QUERY)return;const observer=new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting||loadingRef.current)return;const q=mode==='accounts'?accountsQuery:activeQuery;if(q)fetchFeed(q,cursor,true,mode)},{rootMargin:'1800px 0px 1800px 0px',threshold:0});observer.observe(target);return()=>observer.disconnect()},[cursor,activeQuery,mode,accountsQuery,posts,displayVideos,displayImages,displayMedia])
 function submit(e:FormEvent){e.preventDefault();lastCursorRef.current=null;if(mode==='accounts'){const account=cleanAccount(query);if(!account||accounts.includes(account)||accounts.length>=MAX_ACCOUNTS)return;const next=[...accounts,account];saveAccounts(next);setQuery('');fetchFeed(next.map(x=>`@${x}`).join(','),null,false,'accounts');return}if(query.trim())fetchFeed(query)}
 function switchMode(nextMode:Mode){if(nextMode===mode||loadingRef.current)return;lastCursorRef.current=null;setMode(nextMode);setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null);setActiveQuery('');setFailed(false);setQuery('');if(nextMode==='accounts'&&accounts.length)setTimeout(()=>fetchFeed(accounts.map(x=>`@${x}`).join(','),null,false,'accounts'),0);else if(nextMode==='videos'||(nextMode!=='accounts'&&accounts.length))setTimeout(()=>fetchFeed('',null,false,nextMode,true),0)}
 function removeAccount(account:string){const next=accounts.filter(x=>x!==account);saveAccounts(next);lastCursorRef.current=null;setPosts([]);setDisplayImages([]);setDisplayVideos([]);setDisplayMedia([]);setCursor(null);setActiveQuery('');if(mode==='accounts'&&next.length)setTimeout(()=>fetchFeed(next.map(x=>`@${x}`).join(','),null,false,'accounts'),0);else if(mode==='videos'||(mode!=='accounts'&&next.length))setTimeout(()=>fetchFeed('',null,false,mode,true),0)}
 const hasResults=mode==='videos'?displayVideos.length>0:mode==='accounts'?displayMedia.length>0:displayImages.length>0
 const iconStyle={width:19,height:19,fill:'none',stroke:'currentColor',strokeWidth:2.05,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,opacity:.94}

 return <main className="adultMode">
  {ageChecked&&!adultConfirmed&&<div className="ageGate" role="dialog" aria-modal="true" aria-labelledby="ageGateTitle"><div className="ageGateGlow" aria-hidden="true"/><div className="ageGateCard"><div className="ageMark" aria-hidden="true">18+</div><h1 id="ageGateTitle">Accès réservé aux adultes</h1><p>Je certifie avoir au moins 18 ans et être autorisé à consulter du contenu pour adultes dans mon pays.</p><button className="ageConfirm" type="button" onClick={confirmAdult}>J’ai 18 ans ou plus</button><a className="ageExit" href="https://bsky.app">Je suis mineur</a></div></div>}
  <section className="hero"><div className="topLine"><div className="eyebrow">Recherche visuelle</div><div className="modeTabs" role="tablist" aria-label="Mode">
   <button className={mode==='search'?'active adultTab':'adultTab'} type="button" role="tab" aria-selected={mode==='search'} aria-label="Recherche photo" onClick={()=>switchMode('search')}><svg viewBox="0 0 24 24" aria-hidden="true" style={iconStyle}><rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.8"/><circle cx="8.5" cy="9.4" r="1.45"/><path d="m5.6 16 4.1-4.1 3.15 3.05 2.25-2.2 3.35 3.25"/></svg></button>
   <button className={mode==='videos'?'active videoTab':'videoTab'} type="button" role="tab" aria-selected={mode==='videos'} aria-label="Recherche vidéo" onClick={()=>switchMode('videos')}><svg viewBox="0 0 24 24" aria-hidden="true" style={iconStyle}><rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2.6"/><path d="M7 5v14M17 5v14M3.5 9h3.2M3.5 15h3.2M17.3 9h3.2M17.3 15h3.2"/><path className="videoPlay" d="m10.3 9.1 4.7 2.9-4.7 2.9Z"/></svg></button>
   <button className={mode==='accounts'?'active accountsTab':'accountsTab'} type="button" role="tab" aria-selected={mode==='accounts'} aria-label="Comptes" onClick={()=>switchMode('accounts')}><svg viewBox="0 0 24 24" aria-hidden="true" style={iconStyle}><path d="M12 11.7C10.4 7.6 7.7 5.4 4.3 5.2c-.2 3.5 1.2 6.1 4 7.3-2.5.8-3.9 2.8-4 6.1 3.6-.1 6.2-1.8 7.7-5.1 1.5 3.3 4.1 5 7.7 5.1-.1-3.3-1.5-5.3-4-6.1 2.8-1.2 4.2-3.8 4-7.3-3.4.2-6.1 2.4-7.7 6.5Z"/><path d="M12 10.2v6.1"/></svg></button>
  </div></div>
  <form className={`search ${failed?'failed':''}`} onSubmit={submit}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={mode==='accounts'?'@compte…':'Rechercher…'} aria-label={mode==='accounts'?'Ajouter un compte':mode==='videos'?'Recherche vidéo':'Recherche'} autoComplete="off" spellCheck={false}/><button className={loading?'loading':''} type="submit" disabled={loading||!query.trim()||(mode==='accounts'&&accounts.length>=MAX_ACCOUNTS)} aria-label="Lancer"><span className="searchGlyph" aria-hidden="true"/></button></form>
  {mode==='accounts'&&accounts.length>0&&<div className="accountRail" aria-label="Comptes suivis">{accounts.map(account=><button className="accountChip" key={account} type="button" onClick={()=>removeAccount(account)} aria-label={`Retirer ${account}`}><span>@{account}</span><i aria-hidden="true">×</i></button>)}<span className="accountCount">{accounts.length}/{MAX_ACCOUNTS}</span></div>}
  </section>
  {hasResults&&<section className="resultsSection" aria-label="Résultats">
   {mode==='videos'&&displayVideos.length>0?<div className="videoGrid">{displayVideos.map(({key,video,author})=><VideoCard key={key} mediaKey={key} video={video} author={author}/>)}</div>:mode==='accounts'&&displayMedia.length>0?<div className="mixedGrid">{displayMedia.map(media=>media.kind==='image'?<a className="imageCard mediaViewerItem" href={media.photo.fullsize} key={media.key} aria-label="Ouvrir l’image" data-media-kind="image" data-media-src={media.photo.fullsize} data-media-poster={media.photo.thumb||media.photo.fullsize} data-media-author={media.author}><img src={media.photo.thumb||media.photo.fullsize} alt="" loading="lazy"/></a>:<VideoCard key={media.key} mediaKey={media.key} video={media.video} author={media.author}/>)}</div>:displayImages.length>0?<div className="grid">{displayImages.map(({key,photo,author})=><a className="imageCard mediaViewerItem" href={photo.fullsize} key={key} aria-label="Ouvrir l’image" data-media-kind="image" data-media-src={photo.fullsize} data-media-poster={photo.thumb||photo.fullsize} data-media-author={author}><img src={photo.thumb||photo.fullsize} alt="" loading="lazy"/></a>)}</div>:null}
   {cursor&&activeQuery&&activeQuery!==DISCOVERY_QUERY&&<div className={`infiniteSentinel ${loading?'loading':''}`} ref={infiniteSentinel} aria-hidden="true"><span/></div>}
  </section>}
 </main>
}
