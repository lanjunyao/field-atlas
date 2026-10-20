import {test,expect} from '@playwright/test';import fs from 'node:fs';
test('six-feature local workflow with persisted objects and offline-only tiles',async({page,request})=>{
 const initial=await (await request.get('/api/project')).json();initial.features={type:'FeatureCollection',features:[]};initial.activeSource='osm';initial.customCRS=[];await request.put('/api/project',{data:initial});
 const exceptions=[];page.on('pageerror',e=>exceptions.push(e.message));
 await page.goto('/');await expect(page.locator('#save-state')).toHaveText('已保存到本机');
 await page.locator('[data-tab="sources"]').click();await page.locator('[data-use-source="demo"]').click();
 await page.locator('[data-tab="files"]').click();await page.getByText('示例数据',{exact:true}).click();await page.locator('#load-sample').click();await page.locator('[data-tab="objects"]').click();await expect(page.locator('#object-count')).toHaveText('3');
 const box=await page.locator('#map').boundingBox();const pt=(x,y)=>[box.x+x,box.y+y];
 await page.locator('[data-tool="Point"]').click();await page.mouse.click(...pt(550,400));await expect(page.locator('#object-count')).toHaveText('4');
 await page.locator('[data-tool="LineString"]').click();await page.mouse.click(...pt(400,450));await page.mouse.click(...pt(450,500));await page.mouse.dblclick(...pt(550,520));await expect(page.locator('#object-count')).toHaveText('5');
 await page.locator('[data-tool="Polygon"]').click();await page.mouse.click(...pt(450,260));await page.mouse.click(...pt(530,260));await page.mouse.click(...pt(530,340));await page.mouse.dblclick(...pt(450,340));await expect(page.locator('#object-count')).toHaveText('6');
 await page.locator('#feature-name').fill('验收区域');await page.locator('#feature-name').blur();await expect(page.locator('#object-list')).toContainText('验收区域');
 await page.locator('#undo').click();await expect(page.locator('#object-list')).not.toContainText('验收区域');await page.locator('#redo').click();await expect(page.locator('#object-list')).toContainText('验收区域');
 await page.locator('.object-item').filter({hasText:'验收区域'}).click();
 await expect(page.locator('#save-state')).toHaveText('已保存到本机');
 const beforeDrag=(await (await request.get('/api/project')).json()).features.features.find(f=>f.properties.name==='验收区域').geometry.coordinates;
 await page.mouse.move(...pt(450,260));await page.mouse.down();await page.mouse.move(...pt(430,240),{steps:10});await page.mouse.up();
 await expect(page.locator('#save-state')).toHaveText('已保存到本机');
 const afterDrag=(await (await request.get('/api/project')).json()).features.features.find(f=>f.properties.name==='验收区域').geometry.coordinates;expect(afterDrag).not.toEqual(beforeDrag);
 await page.locator('[data-tab="files"]').click();const dl=page.waitForEvent('download');await page.locator('#export-data').click();const file=await dl;const exported=JSON.parse(fs.readFileSync(await file.path(),'utf8'));expect(exported.features.length).toBe(6);expect(exported.features.some(f=>f.properties.name==='验收区域')).toBeTruthy();expect(exported.features.filter(f=>f.geometry.type==='Polygon').length).toBe(2);
 await page.locator('#export-format').selectOption('gpx');await page.locator('#export-data').click();await expect(page.locator('#toast')).toContainText('GPX 仅支持');
 await page.locator('#export-format').selectOption('kml');const kd=page.waitForEvent('download');await page.locator('#export-data').click();const kml=await kd;expect(fs.readFileSync(await kml.path(),'utf8')).toContain('<kml');
 await page.locator('#import-file').setInputFiles({name:'roundtrip.kml',mimeType:'application/xml',buffer:fs.readFileSync(await kml.path())});await expect(page.locator('#object-count')).toHaveText('12');
 await page.locator('#import-file').setInputFiles('public/samples/points.csv');await expect(page.locator('#object-count')).toHaveText('14');
 await page.locator('[data-tab="coords"]').click();await page.locator('#coord-input').fill('180,0\n0,0');await page.locator('#coord-to').selectOption('EPSG:3857');await page.locator('#convert-coords').click();await expect(page.locator('#coord-result')).toContainText('20037508.342789');
 await page.locator('[data-tab="sources"]').click();await page.locator('#source-name').fill('测试自定义图源');await page.locator('#source-url').fill('http://127.0.0.1:9857/api/tiles/demo/{z}/{x}/{y}');await page.locator('#source-offline').check();await page.locator('#source-form button[type="submit"]').click();await expect(page.locator('#source-list')).toContainText('测试自定义图源');
 await page.locator('[data-tab="offline"]').click();await page.locator('#offline-source').selectOption('demo');await page.locator('#offline-name').fill('验收离线包');await page.locator('#offline-bounds').fill('120.12,30.22,120.17,30.27');await page.locator('#offline-min').fill('12');await page.locator('#offline-max').fill('13');await page.locator('#offline-estimate').click();await expect(page.locator('#offline-estimate-text')).toContainText('张瓦片');
 await page.locator('#offline-form button[type="submit"]').click();await expect(page.locator('#package-list')).toContainText('已就绪',{timeout:30000});await page.locator('[data-action="use"]').first().click();await expect(page.locator('#offline-banner')).toBeVisible();
 const ex=page.waitForEvent('download');await page.locator('[data-action="export"]').first().click();const mb=await ex;expect(fs.statSync(await mb.path()).size).toBeGreaterThan(4096);
 await page.locator('#import-mbtiles').setInputFiles({name:'import.mbtiles',mimeType:'application/octet-stream',buffer:fs.readFileSync(await mb.path())});await expect(page.locator('.package-card')).toHaveCount(2);
 await expect(page.locator('#save-state')).toHaveText('已保存到本机');await page.reload();await expect(page.locator('#object-count')).toHaveText('14');await expect(page.locator('#offline-banner')).toBeVisible();
 // Block all external hosts and confirm the application and package tiles remain usable.
 let external=0,localTiles=0;await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external++;return route.abort();}if(route.request().url().includes('/api/tiles/pack-'))localTiles++;return route.continue();});
 await page.reload();await expect(page.locator('#offline-banner')).toBeVisible();await expect(page.locator('#object-count')).toHaveText('14');await page.waitForTimeout(1200);expect(external).toBe(0);expect(localTiles).toBeGreaterThan(0);
 await page.locator('[data-tab="objects"]').click();await page.screenshot({path:'qa/workspace.png',fullPage:true});expect(exceptions).toEqual([]);
});
test('GPX and KMZ round trip, custom CRS persistence and project restore',async({page,request})=>{
 const p=await (await request.get('/api/project')).json();p.features={type:'FeatureCollection',features:[]};await request.put('/api/project',{data:p});
 await page.goto('/');await expect(page.locator('#save-state')).toHaveText('已保存到本机');await page.locator('[data-tab="files"]').click();await page.locator('#import-file').setInputFiles('public/samples/points.csv');await expect(page.locator('#object-count')).toHaveText('2');
 await page.locator('[data-tab="objects"]').click();await page.locator('.object-item').filter({hasText:'观测点 A'}).click();await page.locator('[data-tab="files"]').click();await page.locator('#export-scope').selectOption('selected');
 for(const format of ['gpx','kmz']){await page.locator('#export-format').selectOption(format);const dl=page.waitForEvent('download');await page.locator('#export-data').click();const file=await dl;await page.locator('#import-file').setInputFiles({name:'roundtrip.'+format,mimeType:'application/octet-stream',buffer:fs.readFileSync(await file.path())});}
 await expect(page.locator('#object-count')).toHaveText('4');
 await page.locator('[data-tab="coords"]').click();await page.locator('summary').filter({hasText:'添加自定义 CRS'}).click();await page.locator('#custom-crs-code').fill('LOCAL:TM120');await page.locator('#custom-crs-def').fill('+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +datum=WGS84 +units=m +no_defs');await page.locator('#add-crs').click();await page.locator('#coord-input').fill('120,0');await page.locator('#convert-coords').click();await expect(page.locator('#coord-result')).toContainText('500000.00000000');await expect(page.locator('#save-state')).toHaveText('已保存到本机');
 await page.reload();await page.locator('[data-tab="coords"]').click();await expect(page.locator('#coord-to option[value="LOCAL:TM120"]')).toHaveCount(1);
 const backup=page.waitForEvent('download');await page.locator('#backup-project').click();const file=await backup;const payload=fs.readFileSync(await file.path());expect(JSON.parse(payload).customCRS.length).toBe(1);
 page.on('dialog',d=>d.accept());await page.locator('[data-tab="objects"]').click();await page.locator('#clear-objects').click();await expect(page.locator('#object-count')).toHaveText('0');await page.locator('[data-tab="files"]').click();await page.locator('#restore-project').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:payload});await expect(page.locator('#object-count')).toHaveText('4');
 await page.locator('#import-file').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('name,lon,lat\nBad,not-a-number,30')});await expect(page.locator('#toast')).toContainText('坐标必须');await expect(page.locator('#object-count')).toHaveText('4');
});
