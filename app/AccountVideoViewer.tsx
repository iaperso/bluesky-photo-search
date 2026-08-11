'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type ViewerState={open:boolean;index:number;src:string;poster:string|null}

function accountVideoCards(){return Array.from(document.querySelectorAll<HTMLElement>('.mixedGrid .videoCard'))}

async function sourceForCard(card:HTMLElement){
 const video=card.querySelector<HTMLVideoElement>('video')
 const start=card.querySelector<HTMLButtonElement>('.videoStart')
 if(!video)return null
 if(!video.currentSrc&&!video.src&&start)start.click()
 for(let i=0;i<24;i++){
  const src=video.currentSrc||video.src
  if(src)return{src,poster:card.querySelector<HTMLImageElement>('.videoPoster')?.src||video.poster||null}
  await new Promise(r=>setTimeout(r,50))
 }
 return null
}

export default function AccountVideoViewer(){
 const[state,setState]=useState<ViewerState>({open:false,index:-1,src:'',poster:null})
 const videoRef=useRef<HTMLVideoElement|null>(null)
 const touchStart=useRef<{x:number;y:number}|null>(null)
 const changing=useRef(false)

 const openAt=useCallback(async(index:number)=>{
  if(changing.current)return
  const cards=accountVideoCards();const card=cards[index];if(!card)return
  changing.current=true
  try{
   const source=await sourceForCard(card);if(!source)return
   setState({open:true,index,src:source.src,poster:source.poster})
  }finally{changing.current=false}
 },[])

 const move=useCallback(async(delta:number)=>{
  const cards=accountVideoCards();if(!cards.length)return
  const next=Math.max(0,Math.min(cards.length-1,state.index+delta));if(next===state.index)return
  videoRef.current?.pause();await openAt(next)
 },[state.index,openAt])

 useEffect(()=>{
  const onClick=(event:MouseEvent)=>{
   const target=event.target as HTMLElement|null
   const card=target?.closest<HTMLElement>('.mixedGrid .videoCard')
   if(!card)return
   const cards=accountVideoCards();const index=cards.indexOf(card);if(index<0)return
   if(target?.closest('video'))return
   event.preventDefault();event.stopPropagation();void openAt(index)
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
  el.src=state.src;el.load();el.play().catch(()=>{})
 },[state.open,state.src])

 if(!state.open)return null

 return <div className="accountViewer" role="dialog" aria-modal="true" aria-label="Vidéo plein écran"
  onTouchStart={e=>{const t=e.touches[0];touchStart.current={x:t.clientX,y:t.clientY}}}
  onTouchEnd={e=>{const s=touchStart.current;touchStart.current=null;if(!s)return;const t=e.changedTouches[0];const dx=t.clientX-s.x;const dy=t.clientY-s.y;if(Math.max(Math.abs(dx),Math.abs(dy))<48)return;if(Math.abs(dy)>=Math.abs(dx))void move(dy<0?1:-1);else void move(dx<0?1:-1)}}>
  <video ref={videoRef} className="accountViewerVideo" poster={state.poster??undefined} controls playsInline preload="auto"/>
  <button className="accountViewerClose" type="button" aria-label="Fermer" onClick={()=>{videoRef.current?.pause();setState({open:false,index:-1,src:'',poster:null})}}>×</button>
  <button className="accountViewerPrev" type="button" aria-label="Vidéo précédente" onClick={()=>void move(-1)}>‹</button>
  <button className="accountViewerNext" type="button" aria-label="Vidéo suivante" onClick={()=>void move(1)}>›</button>
 </div>
}
