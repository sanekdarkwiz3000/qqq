'use strict';
const http=require('node:http');
const https=require('node:https');
const {pipeline}=require('node:stream');

const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function safeHeaders(headers){
 const blocked=new Set([...HOP,...String(headers.connection||'').split(',').map(s=>s.trim().toLowerCase())]);
 return Object.fromEntries(Object.entries(headers).filter(([key])=>!blocked.has(key.toLowerCase())));
}
function originURL(value,allowLoopback=false){
 const url=new URL(value);
 const local=allowLoopback&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!local)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Expected a plain HTTPS origin');
 return url;
}
function createGateway({upstream='https://mediacasino.vercel.app',publicOrigin='',allowLoopback=false,timeout=65000}={}){
 const origin=originURL(upstream,allowLoopback),publicURL=publicOrigin?originURL(publicOrigin):null;
 const transport=origin.protocol==='https:'?https:http;
 const agent=new transport.Agent({keepAlive:true,maxSockets:64,maxFreeSockets:8});
 const server=http.createServer(async(req,res)=>{
  const fail=(status,message)=>{if(res.headersSent){res.destroy();return}res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:message}))};
  if(!['GET','HEAD','POST','OPTIONS'].includes(req.method)){fail(405,'Method not allowed');req.resume();return}
  if(!req.url.startsWith('/')||req.url.startsWith('//')){fail(400,'Invalid request path');req.resume();return}
  let target;try{target=new URL(req.url,origin);if(target.origin!==origin.origin)throw Error()}catch{fail(400,'Invalid request path');req.resume();return}
  if(target.pathname==='/gateway/health'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':JSON.stringify({ok:true,service:'nocturne-gateway'}));req.resume();return;
  }
  const limit=32768;let size=0;const chunks=[];
  try{
   if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>limit)){fail(413,'Request body is too large');req.resume();return}
   for await(const chunk of req){size+=chunk.length;if(size>limit){fail(413,'Request body is too large');return}chunks.push(chunk)}
  }catch{if(!res.destroyed)fail(400,'Incomplete request');return}
  if(res.destroyed)return;
  const headers=safeHeaders(req.headers);
  for(const key of Object.keys(headers))if(key.startsWith('x-forwarded-')||['forwarded','x-real-ip','x-vercel-protection-bypass','x-vercel-set-bypass-cookie','x-vercel-trusted-oidc-idp-token'].includes(key))delete headers[key];
  headers.host=origin.host;delete headers['content-length'];
  if(size||req.method==='POST')headers['content-length']=String(size);
  const upstreamRequest=transport.request(target,{method:req.method,headers,agent},upstreamResponse=>{
   const responseHeaders=safeHeaders(upstreamResponse.headers);
   const privateRequest=target.pathname.startsWith('/api/')||Boolean(req.headers.authorization)||req.method==='POST';
   if(privateRequest){responseHeaders['cache-control']='private, no-store';delete responseHeaders['cdn-cache-control'];delete responseHeaders['vercel-cdn-cache-control'];delete responseHeaders.expires}
   if(publicURL&&responseHeaders.location){try{const location=new URL(responseHeaders.location,origin);if(location.origin===origin.origin)responseHeaders.location=new URL(location.pathname+location.search+location.hash,publicURL).href}catch{}}
   // Bytes are streamed without decompression: Content-Encoding, ranges and WASM remain intact.
   res.writeHead(upstreamResponse.statusCode,responseHeaders);
   pipeline(upstreamResponse,res,()=>{});
  });
  upstreamRequest.setTimeout(timeout,()=>{upstreamRequest.destroy(Error('Upstream timeout'))});
  upstreamRequest.on('error',()=>{if(!res.destroyed)fail(502,'Сервис временно недоступен. Попробуйте ещё раз.')});
  res.on('close',()=>{if(!res.writableFinished)upstreamRequest.destroy()});
  // POST is forwarded exactly once. Request IDs and wallet transactions stay at the origin.
  upstreamRequest.end(Buffer.concat(chunks));
 });
 server.headersTimeout=20000;server.requestTimeout=75000;server.keepAliveTimeout=5000;
 server.on('close',()=>agent.destroy());
 return server;
}
if(require.main===module){
 const server=createGateway({upstream:process.env.UPSTREAM_ORIGIN||'https://mediacasino.vercel.app',publicOrigin:process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||''});
 server.listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Nocturne gateway ready'));
 let closing=false;const shutdown=()=>{if(closing)return;closing=true;server.close();server.closeIdleConnections();setTimeout(()=>process.exit(0),25000).unref()};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
module.exports={createGateway,originURL};
