'use client'

import Hls from 'hls.js'
import { useEffect } from 'react'

export default function AndroidVideoBridge(){
  useEffect(()=>{
    const managed=new WeakMap<HTMLVideoElement,Hls>()
    const nativeHls=(el:HTMLVideoElement)=>Boolean(el.canPlayType('application/vnd.apple.mpegurl'))

    const recover=(el:HTMLVideoElement,src:string)=>{
      if(!src||nativeHls(el)||!Hls.isSupported())return
      const current=managed.get(el)
      if(current){current.destroy();managed.delete(el)}

      // Chrome/Samsung Internet cannot play HLS playlists natively. If a retry
      // put the .m3u8 URL directly on the <video>, clear it before hls.js takes over.
      try{el.pause();el.removeAttribute('src');el.load()}catch{}

      const hls=new Hls({enableWorker:true,lowLatencyMode:false,startFragPrefetch:true,autoStartLoad:true,maxBufferLength:20,backBufferLength:20})
      managed.set(el,hls)

      hls.on(Hls.Events.MEDIA_ATTACHED,()=>{hls.loadSource(src)})
      hls.on(Hls.Events.MANIFEST_PARSED,()=>{void el.play().catch(()=>{})})
      hls.on(Hls.Events.ERROR,(_event,data)=>{
        if(!data.fatal)return
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){hls.startLoad();return}
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();return}
        hls.destroy();managed.delete(el)
      })
      hls.attachMedia(el)
    }

    const handleVideoError=(event:Event)=>{
      const el=event.target
      if(!(el instanceof HTMLVideoElement)||nativeHls(el)||!Hls.isSupported())return
      const card=el.closest<HTMLElement>('.videoCard[data-video-src],.mediaViewerItem[data-video-src]')
      if(!card)return
      const src=card.dataset.videoSrc||card.dataset.mediaSrc||''
      // Only recover the Android native-HLS failure path. hls.js itself uses a
      // MediaSource/blob URL, so this avoids creating two HLS controllers at once.
      const currentSrc=el.getAttribute('src')||''
      if(!src||(!currentSrc.includes('.m3u8')&&!currentSrc.includes('video.bsky.app')))return
      recover(el,src)
    }

    document.addEventListener('error',handleVideoError,true)
    return()=>{
      document.removeEventListener('error',handleVideoError,true)
      document.querySelectorAll('video').forEach(el=>{const h=managed.get(el);if(h)h.destroy()})
    }
  },[])
  return null
}
