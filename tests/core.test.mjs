import test from 'node:test';import assert from 'node:assert/strict';
import {enumerateTiles,tileRange,tmsRow,tileUrl,imageFormat,demoTile,validateSource} from '../core.mjs';
import {convertCoordinate,addCRS} from '../src/coordinates.js';
test('bounds, row convention and bounded tile planning',()=>{assert.deepEqual(tileRange([-180,-85,180,85],0),[0,0,0,0]);assert.equal(enumerateTiles([-180,-85,180,85],0,1).length,5);assert.equal(tmsRow(4,3),12);assert.equal(tileUrl({url:'https://tiles.example/{z}/{x}/{y}.png',scheme:'tms'},4,2,3),'https://tiles.example/4/2/12.png');assert.throws(()=>enumerateTiles([-180,-85,180,85],0,15),/5000/);assert.throws(()=>enumerateTiles([170,-20,-170,20],0,1));assert.throws(()=>enumerateTiles([0,0,1,1],2,1));});
test('image validation rejects successful HTML error responses',()=>{assert.equal(imageFormat(demoTile(2,1,1)),'png');assert.throws(()=>imageFormat(Buffer.from('<html>Login</html>')));});
test('public OSM bulk policy cannot be enabled by re-adding custom source',()=>{assert.equal(validateSource({name:'OSM',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',minZoom:0,maxZoom:19,offlineAllowed:true}).offlineAllowed,false);assert.throws(()=>validateSource({name:'bad',url:'file:///tmp/{z}/{x}/{y}',minZoom:0,maxZoom:5}));});
test('known Web Mercator coordinate and round trip',()=>{const p=convertCoordinate('EPSG:4326','EPSG:3857',[180,0]);assert.ok(Math.abs(p[0]-20037508.342789244)<1e-6);assert.ok(Math.abs(p[1])<1e-6);const a=[120.145,30.246];const xy=convertCoordinate('EPSG:4326','EPSG:32650',a);const back=convertCoordinate('EPSG:32650','EPSG:4326',xy);back.forEach((n,i)=>assert.ok(Math.abs(n-a[i])<1e-7));assert.throws(()=>convertCoordinate('EPSG:4326','EPSG:3857',[0,90]));});
test('UTM central meridian and custom TM definition',()=>{const p=convertCoordinate('EPSG:4326','EPSG:32650',[117,0]);assert.ok(Math.abs(p[0]-500000)<1e-6);assert.ok(Math.abs(p[1])<1e-6);addCRS('LOCAL:TEST','+proj=tmerc +lat_0=0 +lon_0=120 +k=1 +x_0=500000 +y_0=0 +datum=WGS84 +units=m +no_defs');const c=convertCoordinate('EPSG:4326','LOCAL:TEST',[120,0]);assert.ok(Math.abs(c[0]-500000)<1e-6);});
test('GeoJSON declares its CRS, including legacy EPSG URNs',async()=>{
 const {resolveGeoJSONCRS}=await import('../src/coordinates.js');
 const declared=name=>({crs:{type:'name',properties:{name}}});
 assert.equal(resolveGeoJSONCRS(declared('urn:ogc:def:crs:EPSG::4490'),'EPSG:3857'),'EPSG:4490');
 assert.equal(resolveGeoJSONCRS(declared('http://www.opengis.net/def/crs/EPSG/0/4490')),'EPSG:4490');
 assert.equal(resolveGeoJSONCRS(declared('urn:ogc:def:crs:OGC:1.3:CRS84')),'EPSG:4326');
 assert.equal(resolveGeoJSONCRS({},'EPSG:32650'),'EPSG:32650');
 assert.equal(resolveGeoJSONCRS({fieldatlas:{version:1,crs:'EPSG:4326'}},'EPSG:4490'),'EPSG:4326');
 assert.throws(()=>resolveGeoJSONCRS(declared('EPSG:999999')),/不支持/);
 const out=convertCoordinate('EPSG:4490','EPSG:3857',[112.9,22.6]);assert.ok(out.every(Number.isFinite));
});
