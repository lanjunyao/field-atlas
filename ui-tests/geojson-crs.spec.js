import {test,expect} from '@playwright/test';
const fixture={type:'FeatureCollection',crs:{type:'name',properties:{name:'urn:ogc:def:crs:EPSG::4490'}},features:[{type:'Feature',properties:{name:'CGCS2000 测试'},geometry:{type:'Point',coordinates:[112.9,22.6]}}]};
test('uses declared GeoJSON CRS and rejects unknown declarations',async({page,request})=>{
 const p=await (await request.get('/api/project')).json();p.features={type:'FeatureCollection',features:[]};p.activeSource='demo';await request.put('/api/project',{data:p});
 await page.goto('/');await expect(page.locator('#save-state')).toHaveText('已保存到本机');await page.locator('[data-tab="files"]').click();
 await page.locator('#import-file').setInputFiles({name:'cgcs.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 await expect(page.locator('#object-count')).toHaveText('1');await expect(page.locator('#import-crs')).toHaveValue('EPSG:4490');await expect(page.locator('#import-note')).toContainText('CGCS2000');
 const bad={...fixture,crs:{type:'name',properties:{name:'EPSG:999999'}}};await page.locator('#import-file').setInputFiles({name:'unknown.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await expect(page.locator('#toast')).toContainText('不支持');await expect(page.locator('#object-count')).toHaveText('1');
});
