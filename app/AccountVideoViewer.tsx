'use client'

import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'

type ViewerState={open:boolean;index:number;src:string;poster:string|null}

function accountVideoCards(){return Array.from(document.querySelectorAll<HTMLElement>('.mixedGrid .videoCard[data-video-src]'))}
function sourceForCard(card:HTMLElement){const src=card.dataset.videoSrc||'';if(!src)return null;return{src,poster:card.dataset.videoPoster||null}}

export default function AccountVideoViewer(){
 const[state,setState]=useState<ViewerState>({open:false,index:-1,src:'',poster:null})
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const hlsRef=useRef<Hls|null>(null)
 const touchStart=useRef<{x:number;y:number}|null>(null)

 const openAt=useCallback((index:number)=>{
  const cards=accountVideoCards();const card=cards[index];if(!card)return
  const source=sourceForCard(card);if(!source)return
  setState({open:true,index,src:source.src,poster:source.poster})
 },[])

 const move=useCallback((delta:number)=>{
  const cards=accountVideoCards();if(!cards.length)return
  const next=Math.max(0,Math.min(cards.length-1,state.index+delta));if(next===state.index)return
  videoRef.current?.pause();openAt(next)
 },[state.index,openAt])

 useEffect(()=>{
  const onClick=(event:MouseEvent)=>{
   const target=event.target as HTMLElement|null
   const card=target?.closest<HTMLElement>('.mixedGrid .videoCard[data-video-src]')
   if(!card)return
   const cards=accountVideoCards();const index=cards.indexOf(card);if(index<0)return
   event.preventDefault();event.stopPropagation();openAt(index)
  }
  document.addEventListener('click',onClick,true)
  return()=>document.removeEventListener('click',onClick,true)
 },[openAt])

 useEffect(()=>{
  if(!state.open)return
  const old=document.body.style.overflow;document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=old}
 },[state.open])

 useEffect(()=>{
  if(!state.open||!state.src)return
  const el=videoRef.current;if(!el)return
  if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}
  el.pause();el.removeAttribute('src');el.load()

  if(el.canPlayType('application/vnd.apple.mpegurl')){
   el.src=state.src;el.load();el.play().catch(()=>{})
   return
  }
  if(Hls.isSupported()){
   const hls=new Hls({enableWorker:true,startFragPrefetch:true,autoStartLoad:true,maxBufferLength:15})
   hlsRef.current=hls;hls.loadSource(state.src);hls.attachMedia(el)
   hls.on(Hls.Events.MANIFEST_PARSED,()=>el.play().catch(()=>{}))
  }
  return()=>{if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}}
 },[state.open,state.src])

 if(!state.open)return null

 return <div className="accountViewer" role="dialog" aria-modal="true" aria-label="Vidéo plein écran"
  onTouchStart={e=>{const t=e.touches[0];touchStart.current={x:t.clientX,y:t.clientY}}}
  onTouchEnd={e=>{const s=touchStart.current;touchStart.current=null;if(!s)return;const t=e.changedTouches[0];const dx=t.clientX-s.x;const dy=t.clientY-s.y;if(Math.max(Math.abs(dx),Math.abs(dy))<45)return;if(Math.abs(dy)>=Math.abs(dx))move(dy<0?1:-1);else move(dx<0?1:-1)}}>
  <video ref={videoRef} className="accountViewerVideo" poster={state.poster??undefined} controls playsInline preload="auto"/>
  <button className="accountViewerClose" type="button" aria-label="Fermer" onClick={()=>{videoRef.current?.pause();setState({open:false,index:-1,src:'',poster:null})}}>×</button>
  <button className="accountViewerPrev" type="button" aria-label="Vidéo précédente" onClick={()=>move(-1)}>‹</button>
  <button className="accountViewerNext" type="button" aria-label="Vidéo suivante" onClick={()=>move(1)}>›</button>
 </div>
}
