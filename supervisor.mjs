// Detached local service supervisor. SQLite provides an OS-released single-instance lock.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';
const root=path.dirname(fileURLToPath(import.meta.url)),data=process.env.FIELD_ATLAS_DATA||path.join(os.homedir(),'Library','Application Support','FieldAtlas'),port=process.env.PORT||'9847';
fs.mkdirSync(data,{recursive:true});const lock=new DatabaseSync(path.join(data,'service-lock.sqlite'));lock.exec('PRAGMA busy_timeout=1000');lock.exec('CREATE TABLE IF NOT EXISTS singleton(id INTEGER PRIMARY KEY)');
try{lock.exec('BEGIN IMMEDIATE');}catch{lock.close();process.exit(0);}
const pidPath=path.join(data,'supervisor.pid');fs.writeFileSync(pidPath,String(process.pid));
let child,stopping=false,timer,failures=0,started=0;
function log(message){fs.appendFileSync(path.join(data,'supervisor.log'),new Date().toISOString()+' '+message+'\n');}
function cleanup(){try{if(fs.readFileSync(pidPath,'utf8')===String(process.pid))fs.unlinkSync(pidPath);}catch{}try{lock.close();}catch{}}
function start(){
 if(stopping)return;
 const logPath=path.join(data,'server.log');if(fs.existsSync(logPath)&&fs.statSync(logPath).size>5*1024*1024)fs.renameSync(logPath,logPath+'.previous');
 const fd=fs.openSync(logPath,'a');started=Date.now();child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,FIELD_ATLAS_DATA:data,PORT:port},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 fs.writeFileSync(path.join(data,'server.pid'),String(child.pid));log('服务启动 pid='+child.pid);
 child.once('error',e=>log('启动错误 '+e.message));
 child.once('exit',(code,signal)=>{log(`服务退出 code=${code} signal=${signal}`);if(stopping){cleanup();process.exit(0);}if(Date.now()-started>60000)failures=0;failures++;if(failures>5){log('短时间内连续失败，停止重启。请检查 server.log 后重新打开应用。');cleanup();process.exit(1);}timer=setTimeout(start,Math.min(1000*2**(failures-1),16000));});
}
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),20000).unref();}else{cleanup();process.exit(0);}}
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('exit',cleanup);
// Never replace an unknown service already using this port.
try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)});if(r){log('端口已有服务，未创建第二个后台服务');cleanup();process.exit(0);}}catch{}
start();
