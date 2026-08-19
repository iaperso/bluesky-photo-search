'use client'

import { useEffect } from 'react'

type AnyObject=Record<string,any>
const ADULT=new Set(['porn','sexual'])
const HOSTS=['https://api.bsky.app','https://public.api.bsky.app']

function adult(post:AnyObject){
  return (Array.isArray(post?.labels)&&post.labels.some((l:AnyObject)=>!l?.neg&&ADULT.has(String(l?.val??'').toLowerCase())))||
    (Array.isArray(post?.record?.labels?.values)&&post.record.labels.values.some((l:AnyObject)=>ADULT.has(String(l?.val??'').toLowerCase())))
}
function clean(value:unknown){return typeof value==='string'?value.replace(/https?:\/\/(?:www\.)?bsky\.app\/\S*/gi,'').replace(/\.bsky\.social/gi,'').replace(/blue\s*sky|bluesky|bsky\.app|bsky/gi,'').replace(/\s{2,}/g,' ').trim():''}
function images(embed:AnyObject|undefined){const s=embed?.media??embed;if(Array.isArray(s?.images))return s.images.map((i:AnyObject)=>({thumb:i.thumb,fullsize:i.fullsize,alt:clean(i.alt)})).filter((i:AnyObject)=>i.thumb&&i.fullsize);if(Array.isArray(s?.items))return s.items.map((i:AnyObject)=>({thumb:i.thumbnail??i.thumb,fullsize:i.fullsize,alt:clean(i.alt)})).filter((i:AnyObject)=>i.thumb&&i.fullsize);return[]}
function video(embed:AnyObject|undefined){const s=embed?.media??embed;if(!s?.playlist)return null;const playlist=String(s.playlist);return{playlist,thumbnail:typeof s.thumbnail==='string'?s.thumbnail:playlist.replace(/playlist\.m3u8(?:\?.*)?$/,'thumbnail.jpg'),alt:clean(s.alt),aspectRatio:s.aspectRatio&&typeof s.aspectRatio.width==='number'&&typeof s.aspectRatio.height==='number'?{width:s.aspectRatio.width,height:s.aspectRatio.height}:null}}
function normalize(post:AnyObject,adultOnly:boolean,allowVideo=true){if(adultOnly&&!adult(post))return null;const im=images(post.embed);const v=allowVideo?video(post.embed):null;if(!im.length&&!v)return null;const handle=String(post.author?.handle??post.author?.did??'auteur').replace(/^@+/,'');return{uri:post.uri,cid:post.cid,text:clean(post.record?.text),createdAt:post.record?.createdAt??post.indexedAt,indexedAt:post.indexedAt,author:{handle,displayName:clean(post.author?.displayName)||handle,avatar:post.author?.avatar??null},images:im,video:v,likeCount:post.likeCount??0,repostCount:post.repostCount??0}}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','x-visual-search-source':'browser-direct','cache-control':'no-store'}})}
async function xrpc(path:string,params:URLSearchParams){for(const host of HOSTS){try{const r=await fetch(`${host}/xrpc/${path}?${params}`,{headers:{Accept:'application/json'},cache:'no-store'});if(r.ok)return await r.json()}catch{}}return null}
function boundary(posts:AnyObject[]){for(let i=posts.length-1;i>=0;i--){const v=posts[i]?.indexedAt??posts[i]?.record?.createdAt;if(typeof v==='string'&&!Number.isNaN(Date.parse(v)))return v}return null}

async function fallbackSearch(url:URL){
  const q=url.searchParams.get('q')?.trim();if(!q)return json({error:'La recherche est vide.'},400)
  const params=new URLSearchParams({q,sort:url.searchParams.get('sort')==='top'?'top':'latest',limit:'100'})
  const cursor=url.searchParams.get('cursor');if(cursor&&!cursor.startsWith('actor:')&&!Number.isNaN(Date.parse(cursor)))params.set('until',cursor)
  const data=await xrpc('app.bsky.feed.searchPosts',params);if(!data)return null
  const raw=Array.isArray(data.posts)?data.posts:[];const adultOnly=url.searchParams.get('mode')==='adult';const posts=raw.map((p:AnyObject)=>normalize(p,adultOnly,false)).filter(Boolean)
  posts.sort((a:AnyObject,b:AnyObject)=>Date.parse(b.createdAt??'')-Date.parse(a.createdAt??''))
  return json({posts,cursor:boundary(raw),hitsTotal:typeof data.hitsTotal==='number'?data.hitsTotal:null})
}
async function fallbackVideos(url:URL){
  const q=url.searchParams.get('q')?.trim();if(!q)return json({error:'vide'},400)
  const params=new URLSearchParams({q,sort:'latest',limit:'100'});const cursor=url.searchParams.get('cursor');if(cursor&&!Number.isNaN(Date.parse(cursor)))params.set('until',cursor)
  const data=await xrpc('app.bsky.feed.searchPosts',params);if(!data)return null
  const raw=Array.isArray(data.posts)?data.posts:[];const seen=new Set<string>();const posts=[] as AnyObject[]
  for(const p of raw){if(!adult(p))continue;const n=normalize(p,true,true);if(!n?.video||seen.has(n.video.playlist))continue;seen.add(n.video.playlist);n.images=[];posts.push(n);if(posts.length>=20)break}
  return json({posts,cursor:boundary(raw),hitsTotal:null})
}
async function fallbackAccounts(url:URL){
  const actors=[...new Set((url.searchParams.get('q')??'').split(/[\s,;]+/).map(v=>v.trim().replace(/^@+/,'' )).filter(Boolean))].slice(0,20);if(!actors.length)return json({error:'Aucun compte.'},400)
  const pages=await Promise.all(actors.map(async actor=>{const p=new URLSearchParams({actor,limit:'100',filter:'posts_with_media',includePins:'false'});const d=await xrpc('app.bsky.feed.getAuthorFeed',p);return Array.isArray(d?.feed)?d.feed:[]}))
  const seen=new Set<string>();const posts=[] as AnyObject[]
  for(const page of pages)for(const item of page){const p=item?.post;if(!p?.uri||seen.has(p.uri))continue;const n=normalize(p,true,true);if(!n)continue;seen.add(p.uri);posts.push(n)}
  posts.sort((a,b)=>Date.parse(b.createdAt??'')-Date.parse(a.createdAt??''));return json({posts,cursor:null})
}
async function fallbackDiscover(url:URL){
  const kind=url.searchParams.get('kind')==='video'?'video':'image';const seeds=[...new Set((url.searchParams.get('seeds')??'').split(/[\s,;]+/).map(v=>v.trim().replace(/^@+/,'' )).filter(Boolean))].slice(0,12)
  if(!seeds.length&&kind==='image')return json({posts:[],cursor:null,hitsTotal:null})
  if(!seeds.length){const p=new URLSearchParams({q:'nsfw',sort:'latest',limit:'100'});const d=await xrpc('app.bsky.feed.searchPosts',p);if(!d)return null;const posts=(Array.isArray(d.posts)?d.posts:[]).map((x:AnyObject)=>normalize(x,true,true)).filter((x:AnyObject)=>x?.video).slice(0,24);return json({posts,cursor:null,hitsTotal:null})}
  const pages=await Promise.all(seeds.map(async actor=>{const p=new URLSearchParams({actor,limit:'70',filter:'posts_with_media',includePins:'false'});const d=await xrpc('app.bsky.feed.getAuthorFeed',p);return Array.isArray(d?.feed)?d.feed:[]}));const seen=new Set<string>();const posts=[] as AnyObject[]
  for(const page of pages)for(const item of page){const p=item?.post;if(!p?.uri||seen.has(p.uri))continue;const n=normalize(p,true,true);if(!n||(kind==='video'?!n.video:!n.images?.length))continue;seen.add(p.uri);posts.push(n)}
  return json({posts:posts.slice(0,kind==='video'?18:30),cursor:null,hitsTotal:null})
}

export default function BrowserSearchFallback(){
  useEffect(()=>{
    const original=window.fetch.bind(window)
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const requestUrl=typeof input==='string'?input:input instanceof URL?input.href:input.url
      let url:URL
      try{url=new URL(requestUrl,window.location.href)}catch{return original(input,init)}
      if(url.origin!==window.location.origin||!['/api/search','/api/videos','/api/accounts','/api/discover'].includes(url.pathname))return original(input,init)
      const response=await original(input,init)
      if(response.ok||![401,403,429,500,502,503,504].includes(response.status))return response
      try{
        const fallback=url.pathname==='/api/search'?await fallbackSearch(url):url.pathname==='/api/videos'?await fallbackVideos(url):url.pathname==='/api/accounts'?await fallbackAccounts(url):await fallbackDiscover(url)
        return fallback??response
      }catch{return response}
    }
    return()=>{window.fetch=original}
  },[])
  return null
}
