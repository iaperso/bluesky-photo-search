'use client'

import Hls from 'hls.js'
import { useEffect } from 'react'

export default function AndroidVideoBridge(){
  useEffect(()=>{
    const managed=new WeakMap<HTMLVideoElement,Hls>()
    const nativeHls=(el:HTMLVideoElement)=>Boolean(el.canPlayType('application/vnd.apple.mpegurl'))

    const attach=(el:HTMLVideoElement,src:string)=>{
      if(!src||nativeHls(el)||!Hls.isSupported())return
      const current=managed.get(el)
      if(current){current.destroy();managed.delete(el)}
      const hls=new Hls({enableWorker:true,lowLatencyMode:false,startFragPrefetch:true,autoStartLoad:true,maxBufferLength:20,backBufferLength:20})
      managed.set(el,hls)
      hls.on(Hls.Events.ERROR,(_event,data)=>{
        if(!data.fatal)return
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){hls.startLoad();return}
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();return}
      })
      hls.on(Hls.Events.MANIFEST_PARSED,()=>{void el.play().catch(()=>{})})
      hls.loadSource(src)
      hls.attachMedia(el)
    }

    const handle=(event:Event)=>{
      const target=event.target as HTMLElement|null
      const card=target?.closest<HTMLElement>('.videoCard[data-video-src],.mediaViewerItem[data-video-src]')
      if(!card)return
      const el=card.querySelector('video')
      const src=card.dataset.videoSrc||card.dataset.mediaSrc||''
      if(!(el instanceof HTMLVideoElement)||!src||nativeHls(el))return
      if(!managed.has(el))attach(el,src)
    }

    document.addEventListener('pointerdown',handle,true)
    document.addEventListener('click',handle,true)
    return()=>{
      document.removeEventListener('pointerdown',handle,true)
      document.removeEventListener('click',handle,true)
      document.querySelectorAll('video').forEach(el=>{const h=managed.get(el);if(h)h.destroy()})
    }
  },[])
  return null
}
