import express from 'express';
import {SafeStore,validProject,projectRevision,atomicWrite} from './storage.mjs';
import multer from 'multer';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {enumerateTiles,tmsRow,tileUrl,imageFormat,demoTile,DEFAULT_SOURCES,validateSource,validateBounds} from './core.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const DATA=process.env.FIELD_ATLAS_DATA || (process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','FieldAtlas'):path.join(ROOT,'data'));
fs.mkdirSync(path.join(DATA,'packages'),{recursive:true});fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const store=new SafeStore(DATA);
let project=store.load('project.json',{version:1,name:'我的野外项目',sources:DEFAULT_SOURCES,features:{type:'FeatureCollection',features:[]},view:{center:[120.145,30.246],zoom:13},activeSource:'osm'},validProject);
let packages=store.load('packages.json',[],p=>Array.isArray(p)&&p.every(x=>typeof x.id==='string'&&/^[a-zA-Z0-9-]+$/.test(x.id)&&Array.isArray(x.bounds)));
for(const p of packages)if(p.status==='downloading'||p.status==='queued')p.status='paused';
const persistPackages=()=>store.save('packages.json',packages,null);
const active=new Set();
const networkStats={upstream:0,blocked:0,offlineTiles:0};
function packageFile(p){return path.join(DATA,'packages',p.id+'.mbtiles');}
function createDB(p){const db=new DatabaseSync(packageFile(p));db.exec('CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row));');const stmt=db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)');for(const [k,v] of Object.entries({name:p.name,type:'baselayer',version:'1.3',format:'png',bounds:p.bounds.join(','),minzoom:p.minZoom,maxzoom:p.maxZoom,attribution:p.source.attribution,scheme:'tms'}))stmt.run(k,String(v));return db;}
async function fetchTile(source,z,x,y){
 if(source.id==='demo')return demoTile(z,x,y);
 if(process.env.FIELD_ATLAS_NETWORK==='offline'){networkStats.blocked++;throw Error('断网验收模式：禁止访问在线图源');}
 networkStats.upstream++;
 const r=await fetch(tileUrl(source,z,x,y),{headers:{'User-Agent':'FieldAtlasLocal/0.1 (personal local GIS)','Accept':'image/png,image/jpeg,image/webp'},signal:AbortSignal.timeout(15000)});
 if(!r.ok){const e=new Error(`图源返回 HTTP ${r.status}`);e.status=r.status;throw e;}
 const b=Buffer.from(await r.arrayBuffer());if(b.length>8*1024*1024)throw new Error('单张瓦片超过 8 MB');imageFormat(b);return b;
}
async function runPackage(p){
 if(active.has(p.id))return;active.add(p.id);p.status='downloading';p.error='';persistPackages();let db;
 try{
  db=createDB(p);const get=db.prepare('SELECT 1 FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?');const put=db.prepare('INSERT OR REPLACE INTO tiles VALUES(?,?,?,?)');const fmt=db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)');
  const tiles=enumerateTiles(p.bounds,p.minZoom,p.maxZoom);p.done=Number(db.prepare('SELECT count(*) n FROM tiles').get().n);p.failed=0;
  for(const t of tiles){
   if(p.status!=='downloading')break;
   const row=tmsRow(t.z,t.y);if(get.get(t.z,t.x,row))continue;
   let b,error;
   for(let attempt=0;attempt<3;attempt++){try{b=await fetchTile(p.source,t.z,t.x,t.y);break;}catch(e){error=e;if(e.status===429){p.status='paused';p.error='图源限流，已暂停下载；请稍后手动继续。';break;} if(p.status!=='downloading')break;await new Promise(r=>setTimeout(r,300*(attempt+1)));}}
   if(p.status!=='downloading')break;
   if(b){put.run(t.z,t.x,row,b);fmt.run('format',imageFormat(b));p.done++;p.bytes=(p.bytes||0)+b.length;}else{p.failed++;p.error=error?.message||'下载失败';}
   persistPackages();if(p.source.id!=='demo')await new Promise(r=>setTimeout(r,350));
  }
  if(p.status==='downloading')p.status=p.done===p.total?'complete':'error';
 }catch(e){p.status='error';p.error=e.message;}finally{db?.close();active.delete(p.id);persistPackages();}
}
export const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{
 const host=req.headers.host||'';
 if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return res.status(403).json({error:'仅允许本机访问'});
 const origin=req.headers.origin;
 if(origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))return res.status(403).json({error:'拒绝外部页面访问本地数据'});
 if(req.headers['sec-fetch-site']==='cross-site')return res.status(403).json({error:'拒绝跨站请求'});
 next();
});
app.use(express.json({limit:'30mb'}));
app.get('/api/health',(_,res)=>res.json({app:'field-atlas',version:'0.2.0',data:DATA,pid:process.pid,uptime:process.uptime(),recovery:store.events,backupWarning:store.warning,networkMode:process.env.FIELD_ATLAS_NETWORK==='offline'?'offline':'online',networkStats}));
app.get('/api/source-presets',(_,res)=>res.json(DEFAULT_SOURCES));
app.get('/api/project',(_,res)=>res.json({...project,_revision:projectRevision(project)}));
app.get('/api/backups',(_,res)=>res.json(store.list()));
app.get('/api/backups/:id', (req,res)=>{res.json(store.readBackup(req.params.id));});
app.put('/api/project',(req,res)=>{
 const p=req.body;
 if(req.headers['if-match']&&req.headers['if-match']!==projectRevision(project))return res.status(409).json({error:'项目已在其他窗口修改。当前草稿已保留，请先导出草稿并重新载入项目。'});
 if(!p||p.features?.type!=='FeatureCollection'||!Array.isArray(p.features.features)||p.features.features.length>50000)throw new Error('项目格式无效或超过 50000 个对象');
 if(!Array.isArray(p.sources)||p.sources.length>100)throw new Error('图源列表无效');
 const sources=p.sources.map(validateSource);
 const next={version:1,name:String(p.name||'我的野外项目').slice(0,100),features:p.features,sources,view:p.view,activeSource:p.activeSource,customCRS:Array.isArray(p.customCRS)?p.customCRS.filter(x=>typeof x.code==='string'&&typeof x.definition==='string').slice(0,50):[],updatedAt:new Date().toISOString()};
 if(!validProject(next))throw Error('项目结构检查失败');
 store.save('project.json',next,project,{changed:projectRevision(next)!==projectRevision(project)});project=next;res.json({ok:true,updatedAt:project.updatedAt,revision:projectRevision(project),backupWarning:store.warning});
});
app.get('/api/tiles/:id/:z/:x/:y',async(req,res)=>{
 const {id}=req.params;const z=Number(req.params.z),x=Number(req.params.x),y=Number(req.params.y);
 if(![z,x,y].every(Number.isInteger)||z<0||z>22||x<0||y<0||x>=2**z||y>=2**z)return res.sendStatus(400);
 if(id.startsWith('pack-')){
  networkStats.offlineTiles++;
  const p=packages.find(p=>p.id===id.slice(5));if(!p)return res.sendStatus(404);
  const db=new DatabaseSync(packageFile(p),{readOnly:true});let row;try{row=db.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?').get(z,x,p.scheme==='xyz'?y:tmsRow(z,y));}finally{db.close();}
  if(!row)return res.status(404).end();const data=Buffer.from(row.tile_data);res.set('Cache-Control','public,max-age=86400');return res.type(imageFormat(data)==='jpg'?'image/jpeg':`image/${imageFormat(data)}`).send(data);
 }
 const s=project.sources.find(s=>s.id===id);if(!s)return res.sendStatus(404);
 // OSM is loaded directly by the browser for normal HTTP caching and Referer.
 const data=await fetchTile(s,z,x,y);res.set('Cache-Control','public,max-age=86400');res.type(imageFormat(data)==='jpg'?'image/jpeg':`image/${imageFormat(data)}`).send(data);
});
app.get('/api/packages',(_,res)=>res.json(packages.map(({source,...p})=>p)));
app.post('/api/packages/estimate',(req,res)=>{const tiles=enumerateTiles(req.body.bounds,req.body.minZoom,req.body.maxZoom);res.json({total:tiles.length});});
app.post('/api/packages',(req,res)=>{
 const {sourceId,bounds,minZoom,maxZoom}=req.body;const source=project.sources.find(s=>s.id===sourceId);
 if(!source?.offlineAllowed)throw new Error('该图源未允许离线下载。请使用已获授权的自定义图源，或选择离线演练底图。');
 if(minZoom<source.minZoom||maxZoom>source.maxZoom)throw new Error('下载级别超出图源范围');
 const tiles=enumerateTiles(bounds,minZoom,maxZoom);const p={id:randomUUID(),name:String(req.body.name||'区域离线包').slice(0,100),sourceId:source.id,source:{...source},bounds,minZoom,maxZoom,total:tiles.length,done:0,failed:0,bytes:0,status:'queued',scheme:'tms',createdAt:new Date().toISOString(),attribution:source.attribution};
 packages.push(p);persistPackages();createDB(p).close();res.status(201).json(p);void runPackage(p);
});
app.post('/api/packages/:id/:action',(req,res)=>{
 const p=packages.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);
 if(req.params.action==='pause'){if(active.has(p.id))p.status='paused';persistPackages();}
 else if(req.params.action==='resume'){if(!p.source)throw new Error('导入包不支持补充下载');if(active.has(p.id))throw new Error('当前请求尚在结束，请稍后继续');void runPackage(p);}
 else throw new Error('未知操作');res.json({ok:true});
});
app.delete('/api/packages/:id',(req,res)=>{const p=packages.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);if(active.has(p.id))throw new Error('请先暂停，等待当前下载结束后再删除');fs.rmSync(packageFile(p),{force:true});packages=packages.filter(x=>x.id!==p.id);persistPackages();res.json({ok:true});});
app.get('/api/packages/:id/export',(req,res)=>{const p=packages.find(p=>p.id===req.params.id);if(!p)return res.sendStatus(404);if(active.has(p.id))throw new Error('请先暂停下载再导出');res.download(packageFile(p),p.name.replace(/[\\/]/g,'_')+'.mbtiles');});
const upload=multer({dest:path.join(DATA,'uploads'),limits:{fileSize:1024*1024*1024,files:1}});
app.post('/api/packages-import',upload.single('file'),(req,res)=>{
 if(!req.file)throw new Error('请选择 MBTiles 文件');let db;let moved=false;
 try{
  db=new DatabaseSync(req.file.path,{readOnly:true});db.exec('PRAGMA trusted_schema=OFF');
  const meta=Object.fromEntries(db.prepare('SELECT name,value FROM metadata').all().map(r=>[r.name,r.value]));
  const stats=db.prepare('SELECT count(*) n,min(zoom_level) minz,max(zoom_level) maxz,min(tile_column) minx,max(tile_column) maxx FROM tiles').get();
  if(!stats.n||stats.minz<0||stats.maxz>22)throw new Error('瓦片为空或级别不支持');
  const sample=db.prepare('SELECT tile_data FROM tiles LIMIT 1').get();imageFormat(Buffer.from(sample.tile_data));
  if(meta.format && !['png','jpg','jpeg','webp'].includes(meta.format))throw new Error('只支持栅格 MBTiles，不支持 PBF 矢量包');
  const bounds=meta.bounds?.split(',').map(Number)||[-180,-85,180,85];validateBounds(bounds);
  const p={id:randomUUID(),name:String(meta.name||req.file.originalname).slice(0,100),bounds,minZoom:Number(stats.minz),maxZoom:Number(stats.maxz),total:Number(stats.n),done:Number(stats.n),bytes:req.file.size,status:'complete',scheme:meta.scheme==='xyz'?'xyz':'tms',attribution:meta.attribution||'导入离线包',createdAt:new Date().toISOString(),imported:true};
  db.close();db=null;fs.renameSync(req.file.path,packageFile(p));moved=true;packages.push(p);persistPackages();res.status(201).json(p);
 }finally{db?.close();if(!moved)fs.rmSync(req.file.path,{force:true});}
});
app.use(express.static(path.join(ROOT,'dist')));
app.use((err,req,res,next)=>{console.error(err.message);if(!res.headersSent)res.status(400).json({error:err.message||'操作失败'});});
const port=Number(process.env.PORT||9847);
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const server=app.listen(port,'127.0.0.1',()=>console.log(`野图已启动 http://127.0.0.1:${port} · 数据 ${DATA}`));
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已占用，未启动第二个服务':e);process.exit(1);});
 const shutdown=()=>{for(const p of packages)if(active.has(p.id))p.status='paused';try{persistPackages();}catch(e){console.error(e.message);}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),18000).unref();};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
