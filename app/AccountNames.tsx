'use client'

import { useEffect } from 'react'

const cache=new Map<string,string>()

async function displayName(handle:string){
 if(cache.has(handle))return cache.get(handle)!
 try{
  const response=await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`)
  if(response.ok){
   const profile=await response.json()
   const name=typeof profile?.displayName==='string'&&profile.displayName.trim()?profile.displayName.trim():handle
   cache.set(handle,name)
   return name
  }
 }catch{}
 cache.set(handle,handle)
 return handle
}

export default function AccountNames(){
 useEffect(()=>{
  let active=true
  const refresh=()=>{
   document.querySelectorAll<HTMLButtonElement>('.accountRail .accountChip').forEach(button=>{
    const label=button.getAttribute('aria-label')||''
    const handle=label.replace(/^Retirer\s+/,'').replace(/^@+/,'').trim()
    const span=button.querySelector('span')
    if(!handle||!span||button.dataset.nameResolved==='1')return
    button.dataset.nameResolved='1'
    void displayName(handle).then(name=>{if(active&&span.isConnected)span.textContent=name})
   })
  }
  refresh()
  const observer=new MutationObserver(refresh)
  observer.observe(document.body,{childList:true,subtree:true})
  window.addEventListener('visual-search-accounts-changed',refresh)
  return()=>{active=false;observer.disconnect();window.removeEventListener('visual-search-accounts-changed',refresh)}
 },[])
 return null
}
