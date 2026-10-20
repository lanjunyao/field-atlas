import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');fs.mkdirSync(path.join(root,'qa/reliability'),{recursive:true});const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('recovery timeout');}
test('synthetic project survives SIGKILL restart, duplicate launch, revision conflict and corrupt primary recovery',async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-crash-')),port=await freePort(),url=`http://127.0.0.1:${port}`;let sup,dup;
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/project.json')));fs.writeFileSync(path.join(data,'project.json'),JSON.stringify(fixture));
 const start=()=>spawn(process.execPath,[path.join(root,'supervisor.mjs')],{env:{...process.env,FIELD_ATLAS_DATA:data,PORT:String(port)},stdio:'ignore'});
 const health=async()=>{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(500)});return r.json();};
 const stop=async()=>{if(sup&&sup.exitCode===null){sup.kill('SIGTERM');await until(()=>sup.exitCode!==null||sup.signalCode!==null,23000);}};
 try{
  sup=start();const h=await until(health);dup=start();await until(()=>dup.exitCode!==null);assert.equal((await health()).pid,h.pid);
  const p=await (await fetch(url+'/api/project')).json();assert.deepEqual(p.features,fixture.features);
  const next={...p,name:p.name+'（隔离恢复测试）'};const saved=await fetch(url+'/api/project',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':p._revision},body:JSON.stringify(next)});assert.equal(saved.status,200);
  const conflict=await fetch(url+'/api/project',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':p._revision},body:JSON.stringify(p)});assert.equal(conflict.status,409);
  process.kill(h.pid,'SIGKILL');const h2=await until(async()=>{const x=await health();return x.pid!==h.pid&&x;});assert.notEqual(h2.pid,h.pid);assert.deepEqual((await (await fetch(url+'/api/project')).json()).features,fixture.features);
  await stop();fs.writeFileSync(path.join(data,'project.json'),'{interrupted');sup=start();const recovered=await until(health);assert.equal(recovered.recovery.length,1);const latest=await (await fetch(url+'/api/project')).json();assert.equal(latest.name,next.name);assert.deepEqual(latest.features,fixture.features);
  const report={objects:fixture.features.features.length,duplicateLaunch:true,killRestart:true,conflictRejected:true,corruptPrimaryRecovered:true,featuresUnchanged:true};fs.writeFileSync(path.join(root,'qa/reliability/process-test.json'),JSON.stringify(report,null,2));
 }finally{await stop();if(dup?.exitCode===null)dup.kill();fs.rmSync(data,{recursive:true,force:true});}
});
