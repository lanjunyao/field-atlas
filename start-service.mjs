import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),data=process.env.FIELD_ATLAS_DATA||path.join(os.homedir(),'Library','Application Support','FieldAtlas');
fs.mkdirSync(data,{recursive:true});const log=fs.openSync(path.join(data,'launcher.log'),'a');const child=spawn(process.execPath,[path.join(root,'supervisor.mjs')],{cwd:root,env:process.env,detached:true,stdio:['ignore',log,log]});fs.closeSync(log);child.unref();
