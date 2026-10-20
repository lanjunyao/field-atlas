import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function projectRevision(p){const {view,updatedAt,_revision,...content}=p;return digest(content);}
export function validProject(p){return !!p&&p.version===1&&typeof p.name==='string'&&p.features?.type==='FeatureCollection'&&Array.isArray(p.features.features)&&p.features.features.length<=50000&&p.features.features.every(f=>f?.type==='Feature'&&f.geometry&&typeof f.geometry.type==='string'&&('coordinates' in f.geometry||f.geometry.type==='GeometryCollection'))&&Array.isArray(p.sources)&&p.sources.length<=100;}
export function atomicWrite(file,value){
 const temp=file+'.'+randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
export class SafeStore{
 constructor(root,{keep=100,maxBytes=256*1024*1024}={}){this.root=root;this.keep=keep;this.maxBytes=maxBytes;this.events=[];this.warning='';fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'backups'),{recursive:true});fs.mkdirSync(path.join(root,'recovery'),{recursive:true});}
 file(name){if(!['project.json','packages.json'].includes(name))throw Error('未知存储文件');return path.join(this.root,name);}
 entries(name='project.json'){return fs.readdirSync(path.join(this.root,'backups')).filter(n=>n.startsWith(name+'-')&&n.endsWith('.json')).sort().reverse();}
 backupPath(id){if(!/^(project|packages)\.json-[a-zA-Z0-9.-]+\.json$/.test(id))throw Error('备份编号无效');return path.join(this.root,'backups',id);}
 readBackup(id,valid=validProject){const e=JSON.parse(fs.readFileSync(this.backupPath(id),'utf8'));if(e.checksum!==digest(e.data)||!valid(e.data))throw Error('备份校验未通过');return e.data;}
 snapshot(name,value,reason='auto'){
  let previousTime=0;const checksum=digest(value),ids=this.entries(name);if(ids.length){try{const e=JSON.parse(fs.readFileSync(this.backupPath(ids[0]),'utf8'));previousTime=Date.parse(e.createdAt)||0;if(e.checksum===checksum&&digest(e.data)===checksum)return ids[0];}catch{}}
  const createdAt=new Date(Math.max(Date.now(),previousTime+1)).toISOString();const id=`${name}-${createdAt.replace(/[:]/g,'-')}-${randomUUID()}.json`;
  atomicWrite(this.backupPath(id),{version:1,createdAt,reason,checksum,data:value});return id;
 }
 prune(name){let total=0;this.entries(name).forEach((id,index)=>{total+=fs.statSync(this.backupPath(id)).size;if(index>=this.keep||(index>=5&&total>this.maxBytes))fs.unlinkSync(this.backupPath(id));});}
 load(name,fallback,valid){
  let bad=null,value;try{value=JSON.parse(fs.readFileSync(this.file(name),'utf8'));if(!valid(value))throw Error('结构检查失败');}catch(e){value=undefined;if(e.code!=='ENOENT')bad=e;}
  if(value!==undefined){this.snapshot(name,value,'startup');this.prune(name);return value;}
  for(const id of this.entries(name)){try{const value=this.readBackup(id,valid);if(fs.existsSync(this.file(name)))fs.copyFileSync(this.file(name),path.join(this.root,'recovery',name+'.'+Date.now()+'.damaged'));atomicWrite(this.file(name),value);const event={file:name,backup:id,at:new Date().toISOString(),reason:bad?'主文件损坏':'主文件缺失'};this.events.push(event);atomicWrite(path.join(this.root,'recovery','last-recovery.json'),event);return value;}catch(e){if(e.code==='EACCES'||e.code==='ENOSPC')throw e;}}
  if(bad||this.entries(name).length)throw Error(`${name} 无有效副本，已停止加载，原文件未覆盖。请从项目备份恢复。`);
  atomicWrite(this.file(name),fallback);this.snapshot(name,fallback,'initial');return fallback;
 }
 save(name,next,previous,{changed=true}={}){
  if(changed&&previous)this.snapshot(name,previous,'before-change');
  atomicWrite(this.file(name),next);
  try{if(changed)this.snapshot(name,next,'auto');this.prune(name);this.warning='';}catch(e){this.warning='主文件已保存，但自动历史备份失败：'+e.message;}
 }
 list(){return this.entries().map(id=>{try{const data=this.readBackup(id);const e=JSON.parse(fs.readFileSync(this.backupPath(id)));return {id,createdAt:e.createdAt,reason:e.reason,name:data.name,count:data.features.features.length,bytes:fs.statSync(this.backupPath(id)).size};}catch{return null;}}).filter(Boolean);}
}
