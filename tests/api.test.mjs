import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'field-atlas-api-'));process.env.FIELD_ATLAS_DATA=data;const {app}=await import('../server.mjs');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
async function req(url,method='GET',body){return fetch(base+url,{method,headers:body instanceof FormData?{}:{'content-type':'application/json'},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});}
async function json(url,method,body){const r=await req(url,method,body);const j=await r.json();assert.equal(r.ok,true,JSON.stringify(j));return j;}
async function waitFor(id){for(let i=0;i<60;i++){const p=(await json('/api/packages')).find(p=>p.id===id);if(p.status==='complete')return p;if(p.status==='error')throw Error(p.error);await new Promise(r=>setTimeout(r,50));}throw Error('package timeout');}
test('project persistence and offline MBTiles lifecycle',async()=>{
 const initial=await json('/api/project');initial.name='持久化验收';initial.customCRS=[{code:'LOCAL:ONE',definition:'+proj=longlat +datum=WGS84'}];await json('/api/project','PUT',initial);assert.equal((await json('/api/project')).name,'持久化验收');assert.equal(JSON.parse(fs.readFileSync(path.join(data,'project.json'))).customCRS.length,1);
 const p=await json('/api/packages','POST',{name:'演练测试',sourceId:'demo',bounds:[120,30,120.1,30.1],minZoom:4,maxZoom:5});const done=await waitFor(p.id);assert.equal(done.done,done.total);
 const db=new DatabaseSync(path.join(data,'packages',p.id+'.mbtiles'),{readOnly:true});const tile=db.prepare('SELECT * FROM tiles LIMIT 1').get();assert.equal(db.prepare("SELECT value FROM metadata WHERE name='scheme'").get().value,'tms');db.close();
 const r=await req(`/api/tiles/pack-${p.id}/${tile.zoom_level}/${tile.tile_column}/${2**tile.zoom_level-1-tile.tile_row}`);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/png/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(tile.tile_data));
 const missing=await req(`/api/tiles/pack-${p.id}/4/0/0`);assert.equal(missing.status,404);
 const exported=await req(`/api/packages/${p.id}/export`);const bytes=await exported.arrayBuffer();const form=new FormData();form.append('file',new Blob([bytes]),'test.mbtiles');const imported=await json('/api/packages-import','POST',form);assert.equal(imported.done,done.total);assert.equal(imported.imported,true);
 const invalid=new FormData();invalid.append('file',new Blob(['not sqlite']),'bad.mbtiles');assert.equal((await req('/api/packages-import','POST',invalid)).status,400);assert.equal(fs.readdirSync(path.join(data,'uploads')).length,0);
 assert.equal((await req('/api/packages','POST',{sourceId:'osm',bounds:[0,0,1,1],minZoom:0,maxZoom:0})).status,400);
 const cross=await fetch(base+'/api/project',{headers:{Origin:'https://evil.example'}});assert.equal(cross.status,403);
 await json('/api/packages/'+p.id,'DELETE');await json('/api/packages/'+imported.id,'DELETE');assert.equal((await json('/api/packages')).length,0);
});
test.after(()=>{server.close();fs.rmSync(data,{recursive:true,force:true});});
test('pause resumes without losing stored tiles and failed tiles can retry',async()=>{
 const {createServer}=await import('node:http');const {demoTile}=await import('../core.mjs');let fail=true;
 const upstream=createServer(async(req,res)=>{await new Promise(r=>setTimeout(r,100));if(fail){res.writeHead(503);res.end('temporary');}else{res.writeHead(200,{'content-type':'image/png'});res.end(demoTile(1,0,0));}});upstream.listen(0,'127.0.0.1');await new Promise(r=>upstream.once('listening',r));
 try{
  const pr=await json('/api/project');pr.sources.push({id:'test-upstream',name:'test',url:`http://127.0.0.1:${upstream.address().port}/{z}/{x}/{y}`,scheme:'xyz',minZoom:0,maxZoom:5,offlineAllowed:true});await json('/api/project','PUT',pr);
  const p=await json('/api/packages','POST',{name:'pause test',sourceId:'test-upstream',bounds:[0,0,20,20],minZoom:3,maxZoom:3});await json(`/api/packages/${p.id}/pause`,'POST');await new Promise(r=>setTimeout(r,1000));let state=(await json('/api/packages')).find(x=>x.id===p.id);assert.equal(state.status,'paused');assert.ok(state.done<state.total);
  fail=false;await json(`/api/packages/${p.id}/resume`,'POST');state=await waitFor(p.id);assert.equal(state.done,state.total);await json('/api/packages/'+p.id,'DELETE');
  fail=true;const failed=await json('/api/packages','POST',{name:'retry test',sourceId:'test-upstream',bounds:[0,0,1,1],minZoom:0,maxZoom:0});
  for(let i=0;i<80;i++){state=(await json('/api/packages')).find(x=>x.id===failed.id);if(state.status==='error')break;await new Promise(r=>setTimeout(r,100));}assert.equal(state.status,'error');assert.equal(state.failed,1);
  fail=false;await json(`/api/packages/${failed.id}/resume`,'POST');state=await waitFor(failed.id);assert.equal(state.done,1);await json('/api/packages/'+failed.id,'DELETE');
 }finally{upstream.close();}
});
test('rate-limited upstream pauses package instead of hammering the provider',async()=>{
 const {createServer}=await import('node:http');let calls=0;const upstream=createServer((req,res)=>{calls++;res.writeHead(429,{'Retry-After':'60'});res.end('rate limited');});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{const pr=await json('/api/project');pr.sources.push({id:'limited',name:'limited',url:`http://127.0.0.1:${upstream.address().port}/{z}/{x}/{y}`,scheme:'xyz',minZoom:0,maxZoom:2,offlineAllowed:true});await json('/api/project','PUT',pr);const p=await json('/api/packages','POST',{sourceId:'limited',bounds:[0,0,1,1],minZoom:0,maxZoom:0});let state;for(let i=0;i<30;i++){state=(await json('/api/packages')).find(x=>x.id===p.id);if(state.status==='paused')break;await new Promise(r=>setTimeout(r,50));}assert.equal(state.status,'paused');assert.equal(calls,1);assert.equal(state.done,0);assert.match(state.error,/限流/);await json('/api/packages/'+p.id,'DELETE');}finally{upstream.close();}
});
