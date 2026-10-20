import { deflateSync } from 'node:zlib';
export const MAX_TILES = 5000;
export function validateBounds(b) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3] || b[0] < -180 || b[2] > 180 || b[1] < -85.05112878 || b[3] > 85.05112878) throw new Error('范围需为西、南、东、北经纬度；不支持跨越日期变更线或极区');
  return b;
}
export function tileRange(bounds, z) {
  validateBounds(bounds);
  if (!Number.isInteger(z) || z < 0 || z > 22) throw new Error('缩放级别必须为 0–22 的整数');
  const n = 2 ** z, x = lon => Math.floor((lon + 180) / 360 * n);
  const y = lat => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const clamp = v => Math.max(0, Math.min(n - 1, v));
  return [clamp(x(bounds[0])), clamp(y(bounds[3])), clamp(x(bounds[2] - 1e-10)), clamp(y(bounds[1] + 1e-10))];
}
export function enumerateTiles(bounds, minZoom, maxZoom) {
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom > maxZoom) throw new Error('下载级别无效');
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const [x1,y1,x2,y2] = tileRange(bounds,z);
    if (tiles.length + (x2-x1+1)*(y2-y1+1) > MAX_TILES) throw new Error(`单包最多 ${MAX_TILES} 张瓦片，请缩小范围或级别`);
    for (let x=x1;x<=x2;x++) for(let y=y1;y<=y2;y++) tiles.push({z,x,y});
  }
  return tiles;
}
export const tmsRow = (z,y) => 2 ** z - 1 - y;
export function tileUrl(source,z,x,y) {
  const row = source.scheme === 'tms' ? tmsRow(z,y) : y;
  const value = source.url.replaceAll('{z}',String(z)).replaceAll('{x}',String(x)).replaceAll('{y}',String(row)).replaceAll('{s}','a');
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('图源仅支持 HTTP/HTTPS URL，不支持 URL 内用户名密码');
  return u.href;
}
export function imageFormat(b) {
  if (b.length > 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if(b.length>3 && b[0]===255 && b[1]===216 && b[2]===255) return 'jpg';
  if(b.length>12 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return 'webp';
  throw new Error('瓦片不是受支持的 PNG、JPEG 或 WebP 图片');
}
const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data) {const t=Buffer.from(type);const body=Buffer.concat([t,data]);let crc=0xffffffff;for(const c of body)crc=crcTable[(crc^c)&255]^(crc>>>8);const out=Buffer.alloc(body.length+8);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
export function demoTile(z,x,y) {
  // Synthetic training grid, deliberately distinct from a geographic basemap.
  const w=256,raw=Buffer.alloc((w*3+1)*w);
  for(let j=0;j<w;j++)for(let i=0;i<w;i++){
    const gx=x*256+i,gy=y*256+j;const river=Math.abs((gx%1024)-512-90*Math.sin(gy/180))<24;
    const contour=Math.abs(Math.sin(gx/120)+Math.cos(gy/140))<.045;
    const grid=gx%64<1||gy%64<1;
    const color=river?[157,201,208]:grid?[214,220,208]:contour?[208,202,174]:[239,240,225];
    const p=j*(w*3+1)+1+i*3;raw[p]=color[0];raw[p+1]=color[1];raw[p+2]=color[2];
  }
  const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(w,4);head[8]=8;head[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export const SATELLITE_SOURCE={id:'sentinel-2016',name:'Sentinel-2 卫星影像 · 2016/17',url:'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',attribution:'Sentinel-2 cloudless https://s2maps.eu by EOX IT Services GmbH https://eox.at (Contains modified Copernicus Sentinel data 2016 & 2017) · CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ · https://maps.eox.at',scheme:'xyz',minZoom:0,maxZoom:14,offlineAllowed:true,builtin:true,note:'历史卫星影像，非实时；适合区域地形对照，不是航拍级现状图。',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',policyUrl:'https://new.eox.at/2017/08/sentinel-2-global-cloudless-mosaic/'};
export const DEFAULT_SOURCES = [
 SATELLITE_SOURCE,
 {id:'osm',name:'OpenStreetMap · 在线',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© OpenStreetMap contributors',scheme:'xyz',minZoom:0,maxZoom:19,offlineAllowed:false,builtin:true},
 {id:'demo',name:'离线演练底图 · 非真实地理',url:'demo',attribution:'野图程序生成的演练网格 · 非真实地图',scheme:'xyz',minZoom:0,maxZoom:18,offlineAllowed:true,builtin:true}
];
export function validateSource(s) {
 if(!s || typeof s.name!=='string'||!s.name.trim()||s.name.length>100)throw new Error('请填写图源名称（最多 100 字）');
 if(DEFAULT_SOURCES.some(x=>x.id===s.id))return DEFAULT_SOURCES.find(x=>x.id===s.id);
 if(typeof s.url!=='string'||!['{z}','{x}','{y}'].every(k=>s.url.includes(k)))throw new Error('URL 必须包含 {z}、{x}、{y}');
 tileUrl(s,0,0,0);
 if(!Number.isInteger(s.minZoom)||!Number.isInteger(s.maxZoom)||s.minZoom<0||s.maxZoom>22||s.minZoom>s.maxZoom)throw new Error('图源级别需为 0–22');
 const host=new URL(s.url).hostname;
 const noBulk=host==='tile.openstreetmap.org'||host.endsWith('.tile.openstreetmap.org');
 return {id:s.id||crypto.randomUUID(),name:s.name.trim(),url:s.url,attribution:String(s.attribution||'自定义图源'),scheme:s.scheme==='tms'?'tms':'xyz',minZoom:s.minZoom,maxZoom:s.maxZoom,offlineAllowed:!noBulk && s.offlineAllowed===true};
}
