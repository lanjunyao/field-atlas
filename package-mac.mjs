import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url)),bundle=path.join(root,'..','野图.app'),resources=path.join(bundle,'Contents','Resources','app');
fs.mkdirSync(resources,{recursive:true});fs.mkdirSync(path.join(bundle,'Contents','MacOS'),{recursive:true});
fs.copyFileSync(path.join(root,'macos','FieldAtlas'),path.join(bundle,'Contents','MacOS','FieldAtlas'));fs.chmodSync(path.join(bundle,'Contents','MacOS','FieldAtlas'),0o755);fs.copyFileSync(path.join(root,'macos','Info.plist'),path.join(bundle,'Contents','Info.plist'));
for(const file of ['server.mjs','core.mjs','storage.mjs','supervisor.mjs','start-service.mjs','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.txt'])fs.copyFileSync(path.join(root,file),path.join(resources,file));
fs.cpSync(path.join(root,'dist'),path.join(resources,'dist'),{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';const install=spawnSync(npm,['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:resources,stdio:'inherit'});if(install.status!==0)process.exit(install.status);
fs.copyFileSync(fs.realpathSync(process.execPath),path.join(bundle,'Contents','MacOS','node'));fs.chmodSync(path.join(bundle,'Contents','MacOS','node'),0o755);
const executable=fs.realpathSync(process.execPath);
const candidates=[path.resolve(path.dirname(executable),'..','LICENSE'),path.join(path.dirname(executable),'LICENSE')];
const localLicense=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
if(localLicense)fs.copyFileSync(localLicense,path.join(resources,'NODE_LICENSE.txt'));
else {const url=`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;const response=await fetch(url);if(!response.ok)throw Error('无法取得此Node版本的LICENSE，请安装带LICENSE的官方Node发行包后重新打包');fs.writeFileSync(path.join(resources,'NODE_LICENSE.txt'),await response.text());}
console.log('已打包',bundle);
