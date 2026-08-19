import { NextResponse } from 'next/server'

export const runtime='edge'

export async function GET(){
  const url='https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=cat&limit=3&sort=latest'
  try{
    const started=Date.now()
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 (compatible; VisualSearch-Edge/1.0; +https://ia-perso.vercel.app)'},cache:'no-store'})
    return NextResponse.json({status:r.status,ok:r.ok,ms:Date.now()-started})
  }catch(error){
    return NextResponse.json({status:0,ok:false,error:error instanceof Error?error.name:'error'},{status:200})
  }
}
