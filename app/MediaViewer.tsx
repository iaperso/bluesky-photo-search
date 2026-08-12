'use client'

import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'

type MediaKind='image'|'video'
type ViewerState={open:boolean;index:number;kind:MediaKind;src:string;poster:string|null;author:string|null}
const ACCOUNTS_KEY='visual-search-accounts-v2'
const MAX_ACCOUNTS=20

function mediaCards(){return Array.from(document.querySelectorAll<HTMLElement>('.mediaViewerItem[data-media-kind][data-media-src]'))}
function actorFromMedia(src:string){try{return decodeURIComponent(src).match(/did:plc:[a-z0-9]+/i)?.[0]??null}catch{return src.match(/did:plc:[a-z0-9]+/i)?.[0]??null}}
function sourceForCard(card:HTMLElement){const src=card.dataset.mediaSrc||'';const kind=card.dataset.mediaKind==='video'?'video':'image';if(!src)return null;return{kind:kind as MediaKind,src,poster:card.dataset.mediaPoster||null,author:card.dataset.mediaAuthor||actorFromMedia(src)}}

export default function MediaViewer(){
 const[state,setState]=useState<ViewerState>({open:false,index:-1,kind:'image',src:'',poster:null,author:null})
 const[flowed,setFlowed]=useState(false)
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const hlsRef=useRef<Hls|null>(null)
 const touchStart=useRef<{x:number;y:number}|null>(null)

 const openAt=useCallback((index:number)=>{const cards=mediaCards();const source=cards[index]?sourceForCard(cards[index]):null;if(!source)return;setFlowed(false);setState({open:true,index,kind:source.kind,src:source.src,poster:source.poster,author:source.author})},[])
 const move=useCallback((delta:number)=>{const cards=mediaCards();if(!cards.length)return;const next=Math.max(0,Math.min(cards.length-1,state.index+delta));if(next===state.index)return;videoRef.current?.pause();openAt(next)},[state.index,openAt])

 useEffect(()=>{const onClick=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;const card=target?.closest<HTMLElement>('.mediaViewerItem[data-media-kind][data-media-src]');if(!card)return;const index=mediaCards().indexOf(card);if(index<0)return;event.preventDefault();event.stopPropagation();openAt(index)};document.addEventListener('click',onClick,true);return()=>document.removeEventListener('click',onClick,true)},[openAt])
 useEffect(()=>{if(!state.open)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old}},[state.open])
 useEffect(()=>{const el=videoRef.current;if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}if(!el)return;el.pause();if(!state.open||state.kind!=='video'||!state.src){el.removeAttribute('src');el.load();return}el.muted=true;el.autoplay=true;el.playsInline=true;if(el.canPlayType('application/vnd.apple.mpegurl')){if(el.src!==state.src)el.src=state.src;el.load();void el.play().catch(()=>{});return}if(Hls.isSupported()){const hls=new Hls({enableWorker:true,startFragPrefetch:true,autoStartLoad:true,maxBufferLength:12,backBufferLength:12});hlsRef.current=hls;hls.loadSource(state.src);hls.attachMedia(el);hls.on(Hls.Events.MANIFEST_PARSED,()=>{void el.play().catch(()=>{})})}return()=>{if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}}},[state.open,state.kind,state.src])
 useEffect(()=>{if(!state.open)return;const next=mediaCards()[state.index+1];if(!next)return;const source=sourceForCard(next);if(source?.kind==='image'){const img=new Image();img.src=source.src}},[state.open,state.index])

 function close(){videoRef.current?.pause();setState({open:false,index:-1,kind:'image',src:'',poster:null,author:null})}
 async function addFlow(){
  let author=state.author?.trim().replace(/^@+/,'')
  if(!author)return
  try{
   if(author.startsWith('did:')){
    const response=await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(author)}`)
    if(response.ok){const profile=await response.json();if(typeof profile?.handle==='string'&&profile.handle)author=profile.handle}
   }
   const finalAuthor=author
   if(!finalAuthor)return
   const saved=JSON.parse(localStorage.getItem(ACCOUNTS_KEY)??'[]')
   const current=Array.isArray(saved)?saved.filter((item):item is string=>typeof item==='string'):[]
   if(!current.includes(finalAuthor)&&current.length<MAX_ACCOUNTS){const next=[...current,finalAuthor];localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(next));window.dispatchEvent(new CustomEvent('visual-search-accounts-changed',{detail:next}))}
   setFlowed(true)
  }catch{}
 }

 return <div className={`mediaViewer ${state.open?'isOpen':''}`} role="dialog" aria-modal={state.open?'true':'false'} aria-label="Média plein écran" onTouchStart={e=>{if(!state.open)return;const target=e.target as HTMLElement;if(target.closest('button')){touchStart.current=null;return}const t=e.touches[0];touchStart.current={x:t.clientX,y:t.clientY}}} onTouchEnd={e=>{if(!state.open)return;const target=e.target as HTMLElement;if(target.closest('button')){touchStart.current=null;return}const s=touchStart.current;touchStart.current=null;if(!s)return;const t=e.changedTouches[0];const dx=t.clientX-s.x;const dy=t.clientY-s.y;if(Math.max(Math.abs(dx),Math.abs(dy))<45)return;Math.abs(dy)>=Math.abs(dx)?move(dy<0?1:-1):move(dx<0?1:-1)}}>
  {state.kind==='image'&&state.open?<img className="mediaViewerImage" src={state.src} alt=""/>:<video ref={videoRef} className="mediaViewerVideo" poster={state.poster??undefined} controls playsInline muted preload="auto" onEnded={()=>move(1)}/>} 
  {state.open&&<><button className="mediaViewerClose" type="button" aria-label="Fermer" onClick={close}>×</button><button className="mediaViewerPrev" type="button" aria-label="Média précédent" onClick={()=>move(-1)}>‹</button><button className="mediaViewerNext" type="button" aria-label="Média suivant" onClick={()=>move(1)}>›</button>{state.author&&<button className={`mediaViewerFlow ${flowed?'isFlowed':''}`} type="button" aria-label="Ajouter au suivi comptes" onPointerDown={e=>e.stopPropagation()} onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();void addFlow()}}><span className="flowFlame" aria-hidden="true">♦</span><span>flow</span></button>}</>}
 </div>
}