import { NextResponse } from 'next/server'

const DATA='UklGRroAAAA='

export async function GET(){
 const body=Buffer.from(DATA,'base64')
 return new NextResponse(body,{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable'}})
}
