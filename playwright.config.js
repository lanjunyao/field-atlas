import {defineConfig} from '@playwright/test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'field-atlas-ui-'));
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for(const folder of ['qa/reliability','qa/screenshot-rebuild'])fs.mkdirSync(folder,{recursive:true});
export default defineConfig({testDir:'./ui-tests',workers:1,timeout:60000,retries:0,use:{baseURL:'http://127.0.0.1:9857',viewport:{width:1440,height:1000},launchOptions:fs.existsSync(chrome)?{executablePath:chrome}:{},screenshot:'only-on-failure',trace:'retain-on-failure'},webServer:{command:'node server.mjs',url:'http://127.0.0.1:9857/api/health',env:{PORT:'9857',FIELD_ATLAS_DATA:data},reuseExistingServer:false}});
