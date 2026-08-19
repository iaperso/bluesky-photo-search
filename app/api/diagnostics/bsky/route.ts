import { NextResponse } from 'next/server'

const UA='Mozilla/5.0 (compatible; VisualSearch-Diagnostics/1.0; +https://ia-perso.vercel.app)'

async function probe(name:string,url:string,headers:Record<string,string>={}){
  const started=Date.now()
  try{
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA,...headers},cache:'no-store',signal:AbortSignal.timeout(6000)})
    return {name,status:r.status,ok:r.ok,ms:Date.now()-started}
  }catch(error){
    return {name,status:0,ok:false,ms:Date.now()-started,error:error instanceof Error?error.name:'error'}
  }
}

export async function GET(){
  const path='/xrpc/app.bsky.feed.searchPosts?q=cat&limit=3&sort=latest'
  const results=await Promise.all([
    probe('api','https://api.bsky.app'+path),
    probe('public','https://public.api.bsky.app'+path),
    probe('entryway-proxy','https://bsky.social'+path,{'atproto-proxy':'did:web:api.bsky.app#bsky_appview'}),
    probe('entryway-legacy','https://bsky.social'+path)
  ])
  return NextResponse.json({results},{headers:{'Cache-Control':'no-store'}})
}
