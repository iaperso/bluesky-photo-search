'use client'

import Hls from 'hls.js'
import { useCallback, useEffect, useRef, useState } from 'react'

type MediaKind='image'|'video'
type ViewerState={open:boolean;index:number;kind:MediaKind;src:string;poster:string|null}

function mediaCards(){return Array.from(document.querySelectorAll<HTMLElement>('.mediaViewerItem[data-media-kind][data-media-src]'))}
function sourceForCard(card:HTMLElement){
 const src=card.dataset.mediaSrc||''
 const kind=card.dataset.mediaKind==='video'?'video':'image'
 if(!src)return null
 return{kind:kind as MediaKind,src,poster:card.dataset.mediaPoster||null}
}

export default function AccountVideoViewer(){
 const[state,setState]=useState<ViewerState>({open:false,index:-1,kind:'image',src:'',poster:null})
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const hlsRef=useRef<Hls|null>(null)
 const touchStart=useRef<{x:number;y:number}|null>(null)

 const openAt=useCallback((index:number)=>{
  const cards=mediaCards();const card=cards[index];if(!card)return
  const source=sourceForCard(card);if(!source)return
  setState({open:true,index,kind:source.kind,src:source.src,poster:source.poster})
 },[])

 const move=useCallback((delta:number)=>{
  const cards=mediaCards();if(!cards.length)return
  const next=Math.max(0,Math.min(cards.length-1,state.index+delta));if(next===state.index)return
  videoRef.current?.pause();openAt(next)
 },[state.index,openAt])

 useEffect(()=>{
  const onClick=(event:MouseEvent)=>{
   const target=event.target as HTMLElement|null
   const card=target?.closest<HTMLElement>('.mediaViewerItem[data-media-kind][data-media-src]')
   if(!card)return
   const cards=mediaCards();const index=cards.indexOf(card);if(index<0)return
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
  const el=videoRef.current
  if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}
  if(!el)return

  el.pause()
  if(!state.open||state.kind!=='video'||!state.src){
   el.removeAttribute('src');el.load();return
  }

  el.muted=true
  el.autoplay=true
  el.playsInline=true

  if(el.canPlayType('application/vnd.apple.mpegurl')){
   if(el.src!==state.src)el.src=state.src
   el.load();void el.play().catch(()=>{})
   return
  }

  if(Hls.isSupported()){
   const hls=new Hls({enableWorker:true,startFragPrefetch:true,autoStartLoad:true,maxBufferLength:12,backBufferLength:12})
   hlsRef.current=hls;hls.loadSource(state.src);hls.attachMedia(el)
   hls.on(Hls.Events.MANIFEST_PARSED,()=>{void el.play().catch(()=>{})})
  }

  return()=>{if(hlsRef.current){hlsRef.current.destroy();hlsRef.current=null}}
 },[state.open,state.kind,state.src])

 useEffect(()=>{
  if(!state.open)return
  const cards=mediaCards();const next=cards[state.index+1];if(!next)return
  const source=sourceForCard(next);if(!source)return
  if(source.kind==='image'){const img=new Image();img.src=source.src}
 },[state.open,state.index])

 function close(){videoRef.current?.pause();setState({open:false,index:-1,kind:'image',src:'',poster:null})}

 return <div className={`accountViewer ${state.open?'isOpen':''}`} role="dialog" aria-modal={state.open?'true':'false'} aria-label="Média plein écran"
  onTouchStart={e=>{if(!state.open)return;const t=e.touches[0];touchStart.current={x:t.clientX,y:t.clientY}}}
  onTouchEnd={e=>{if(!state.open)return;const s=touchStart.current;touchStart.current=null;if(!s)return;const t=e.changedTouches[0];const dx=t.clientX-s.x;const dy=t.clientY-s.y;if(Math.max(Math.abs(dx),Math.abs(dy))<45)return;if(Math.abs(dy)>=Math.abs(dx))move(dy<0?1:-1);else move(dx<0?1:-1)}}>
  {state.kind==='image'&&state.open?<img className="accountViewerImage" src={state.src} alt=""/>:<video ref={videoRef} className="accountViewerVideo" poster={state.poster??undefined} controls playsInline muted preload="auto" onEnded={()=>move(1)}/>} 
  {state.open&&<>
   <button className="accountViewerClose" type="button" aria-label="Fermer" onClick={close}>×</button>
   <button className="accountViewerPrev" type="button" aria-label="Média précédent" onClick={()=>move(-1)}>‹</button>
   <button className="accountViewerNext" type="button" aria-label="Média suivant" onClick={()=>move(1)}>›</button>
  </>}
 </div>
}
