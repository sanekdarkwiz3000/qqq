const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const zlib=require('node:zlib');
const {createGateway,originURL}=require('./server.cjs');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
async function withGateway(handler,run,options={}){
 const upstream=http.createServer(handler),origin=await listen(upstream),gateway=createGateway({upstream:origin,allowLoopback:true,...options}),base=await listen(gateway);
 try{await run(base)}finally{gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve))}
}
test('preserves URL, query, auth, POST body and exactly one request',async()=>{
 const seen=[];
 await withGateway(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);seen.push({url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()});res.setHeader('Content-Type','application/json');res.end('{"ok":true}')},async base=>{
  const payload='{"action":"test","request_id":"fictional-123456"}';const response=await fetch(base+'/api/action?mode=1',{method:'POST',headers:{authorization:'tma fictional-test-only','content-type':'application/json','x-forwarded-for':'spoof','x-vercel-protection-bypass':'spoof'},body:payload});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(seen.length,1);assert.equal(seen[0].url,'/api/action?mode=1');assert.equal(seen[0].body,payload);assert.equal(seen[0].headers.authorization,'tma fictional-test-only');assert.equal(seen[0].headers['x-forwarded-for'],undefined);assert.equal(seen[0].headers['x-vercel-protection-bypass'],undefined);
 })
});
test('streams compressed binary bytes with correct encoding',async()=>{
 const bytes=Buffer.from([0,97,115,109,255,1,0]),compressed=zlib.gzipSync(bytes);
 await withGateway((req,res)=>{res.writeHead(200,{'Content-Type':'application/wasm','Content-Encoding':'gzip','Content-Length':compressed.length,'Cache-Control':'public, max-age=3600'});res.end(compressed)},async base=>{
  const response=await fetch(base+'/vendor/engine.wasm');assert.equal(response.headers.get('content-encoding'),'gzip');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'public, max-age=3600');
 })
});
test('preserves audio range, HEAD and upstream status',async()=>{
 await withGateway((req,res)=>{if(req.method==='HEAD'){res.writeHead(200,{'Content-Length':'99'});res.end();return}assert.equal(req.headers.range,'bytes=1-3');res.writeHead(206,{'Content-Range':'bytes 1-3/5','Content-Length':'3'});res.end('bcd')},async base=>{
  const range=await fetch(base+'/sound.mp3',{headers:{range:'bytes=1-3'}});assert.equal(range.status,206);assert.equal(await range.text(),'bcd');assert.equal(range.headers.get('content-range'),'bytes 1-3/5');const head=await fetch(base+'/sound.mp3',{method:'HEAD'});assert.equal(head.headers.get('content-length'),'99');assert.equal(await head.text(),'');
 })
});
test('rejects non-HTTPS origins and URL credentials',()=>{
 for(const value of ['http://example.com','https://user:password@example.com','https://example.com/path','https://example.com/?q=1'])assert.throws(()=>originURL(value));
 assert.throws(()=>createGateway({upstream:'http://127.0.0.1:1234'}));assert.equal(originURL('https://mediacasino.vercel.app').origin,'https://mediacasino.vercel.app');
});
test('health does not invoke Vercel and oversized bodies never reach upstream',async()=>{
 let calls=0;await withGateway((req,res)=>{calls++;res.end('unexpected')},async base=>{
  assert.equal((await (await fetch(base+'/gateway/health')).json()).ok,true);assert.equal(calls,0);
  assert.equal((await fetch(base+'/api/action',{method:'POST',body:'x'.repeat(32769)})).status,413);assert.equal(calls,0);
 })
});
test('rejects absolute destinations and unsupported methods',async()=>{
 let calls=0;await withGateway((req,res)=>{calls++;res.end()},async base=>{
  assert.equal((await fetch(base+'//evil.example/path')).status,400);assert.equal((await fetch(base+'/api/action',{method:'DELETE'})).status,405);assert.equal(calls,0);
 })
});
test('rewrites only origin redirects and keeps auth errors uncacheable',async()=>{
 await withGateway((req,res)=>{res.writeHead(302,{Location:'/login?next=1'});res.end()},async base=>{
  const response=await fetch(base+'/redirect',{redirect:'manual'});assert.equal(response.headers.get('location'),'https://gateway.example/login?next=1');
 },{publicOrigin:'https://gateway.example'});
 await withGateway((req,res)=>{res.writeHead(401,{'Cache-Control':'public, max-age=600','Vercel-CDN-Cache-Control':'public, max-age=600'});res.end('denied')},async base=>{
  const response=await fetch(base+'/api/state');assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vercel-cdn-cache-control'),null);
 })
});
test('upstream timeout returns an error without retrying a POST',async()=>{
 let calls=0;await withGateway((req,res)=>{calls++},async base=>{const response=await fetch(base+'/api/action',{method:'POST',body:'{}'});assert.equal(response.status,502);assert.equal(calls,1)},{timeout:50});
});
