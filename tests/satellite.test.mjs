import test from 'node:test';import assert from 'node:assert/strict';import {SATELLITE_SOURCE,tileUrl,validateSource,enumerateTiles} from '../core.mjs';
test('satellite preset matches published WMTS XYZ column/row convention and preserves provenance',()=>{
 const s=validateSource(SATELLITE_SOURCE);assert.equal(tileUrl(s,12,1,2),'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/12/2/1.jpg');assert.equal(s.offlineAllowed,true);assert.equal(s.maxZoom,14);assert.match(s.name,/2016/);assert.match(s.attribution,/2016 & 2017/);assert.equal(s.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');
});
test('small synthetic region produces a bounded offline package',()=>{const tiles=enumerateTiles([120.1,30.2,120.18,30.28],8,12);assert.ok(tiles.length>0&&tiles.length<5000);assert.ok(tiles.every(t=>t.z>=8&&t.z<=12));});
