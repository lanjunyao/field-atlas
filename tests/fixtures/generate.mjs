// Synthetic coordinates and shapes, unrelated to any user's business data.
import fs from 'node:fs';import {shapeFeature} from '../../src/shapes.js';
const root=new URL('./',import.meta.url);
const points=Array.from({length:44},(_,i)=>({type:'Feature',id:'point-'+(i+1),properties:{name:String(i+1)},geometry:{type:'Point',coordinates:[Number((120.1+(i%8)*.012).toFixed(6)),Number((30.2+Math.floor(i/8)*.012).toFixed(6))]}}));
const polygons=Array.from({length:3},(_,i)=>{const x=120.1+i*.025,y=30.2;return {type:'Feature',id:'area-'+i,properties:{name:'演示区域'+(i+1)},geometry:{type:'Polygon',coordinates:[[[x,y],[x+.02,y],[x+.02,y+.02],[x,y+.02],[x,y]]]}};});
const collection={type:'FeatureCollection',fieldatlas:{version:1,crs:'EPSG:4326'},features:[...points,...polygons]};
fs.writeFileSync(new URL('synthetic.geojson',root),JSON.stringify(collection,null,2));
const estimates=Array.from({length:29},(_,i)=>{const kind=i<26?'circle':'ellipse',spec={version:1,kind,center:[120.14+(i%6)*.01,30.24+Math.floor(i/6)*.01],rotationDeg:0,provenance:'estimated',note:'合成测试数据，非实际边界',...(kind==='circle'?{radiusMeters:i===0?4004:1500}:{semiAxisAMeters:2500,semiAxisBMeters:1500})};return shapeFeature(spec,{name:String(i+1).padStart(2,'0')+' 演示覆盖区',color:'#b59a00',_fieldatlas_layer:'估算演示 · 未核对',screenshot_object_id:String(i+1).padStart(2,'0')});});
fs.writeFileSync(new URL('estimates.geojson',root),JSON.stringify({type:'FeatureCollection',features:estimates},null,2));
const sources=[{id:'osm',name:'OpenStreetMap',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',scheme:'xyz',minZoom:0,maxZoom:19,offlineAllowed:false,builtin:true},{id:'demo',name:'演练网格',url:'demo',scheme:'xyz',minZoom:0,maxZoom:18,offlineAllowed:true,builtin:true}];
fs.writeFileSync(new URL('project.json',root),JSON.stringify({version:1,name:'合成恢复测试',sources,activeSource:'demo',view:{center:[120.14,30.24],zoom:12},features:{type:'FeatureCollection',features:[...points.slice(0,3),...polygons.slice(0,1),{...estimates[0],id:'circle-demo'}]}},null,2));
