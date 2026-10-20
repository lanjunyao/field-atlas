// Independent parametric shapes. Geometry is a standard Polygon; metadata keeps
// the editable parameters. This is not an Ovital private-format interpretation.
export const SHAPE_KEY = '_fieldatlas_shape';
export const EARTH_RADIUS = 6371008.8;
export const SHAPE_SEGMENTS = 256;
const rad = Math.PI / 180;
export function normalizeShape(value) {
  const s = typeof value === 'string' ? JSON.parse(value) : value;
  if (!s || s.version !== 1 || !['circle', 'ellipse'].includes(s.kind)) throw new Error('不支持的圆形参数版本或类型');
  if (!Array.isArray(s.center) || s.center.length !== 2 || !s.center.every(Number.isFinite) || Math.abs(s.center[0]) > 180 || Math.abs(s.center[1]) > 84) throw new Error('圆心需为有效经纬度，纬度限制在 ±84°');
  const a = s.kind === 'circle' ? s.radiusMeters : s.semiAxisAMeters;
  const b = s.kind === 'circle' ? s.radiusMeters : s.semiAxisBMeters;
  if (![a, b].every(n => Number.isFinite(n) && n >= 1 && n <= 200000)) throw new Error('半径 / 半轴需在 1–200000 米之间');
  if (!Number.isFinite(s.rotationDeg)) throw new Error('旋转角必须是有效数字');
  if (!['estimated', 'specified'].includes(s.provenance)) throw new Error('请选择估算或手工参数来源');
  if (s.centerCRS && s.centerCRS !== 'EPSG:4326') throw new Error('圆形参数中心坐标固定为 WGS84 经度、纬度');
  const out = {version:1, kind:s.kind, center:[...s.center], centerCRS:'EPSG:4326', rotationDeg:((s.rotationDeg % 360)+360)%360, provenance:s.provenance, note:String(s.note || '').slice(0,1000)};
  if (s.kind === 'circle') {out.radiusMeters=a;out.rotationDeg=0;}
  else {out.semiAxisAMeters=a;out.semiAxisBMeters=b;}
  return out;
}
export function destination(center, distance, bearing) {
  const lon=center[0]*rad,lat=center[1]*rad,b=bearing*rad,d=distance/EARTH_RADIUS;
  const y=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(b));
  const x=lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(y));
  return [((x/rad+540)%360)-180,y/rad];
}
export function shapeRing(value) {
  const s=normalizeShape(value),a=s.kind==='circle'?s.radiusMeters:s.semiAxisAMeters,b=s.kind==='circle'?s.radiusMeters:s.semiAxisBMeters;
  const rotation=s.rotationDeg*rad,ring=[];
  for(let i=0;i<SHAPE_SEGMENTS;i++) {
    const t=i*2*Math.PI/SHAPE_SEGMENTS,along=a*Math.cos(t),across=b*Math.sin(t);
    const east=along*Math.sin(rotation)+across*Math.cos(rotation),north=along*Math.cos(rotation)-across*Math.sin(rotation);
    const p=destination(s.center,Math.hypot(east,north),Math.atan2(east,north)/rad);
    if(Math.abs(p[1])>85.05112878 || Math.abs(p[0]-s.center[0])>180)throw new Error('该区域跨越日期变更线或超出地图纬度范围，暂不支持');
    ring.push(p);
  }
  ring.push([...ring[0]]);return ring;
}
export function shapeFeature(spec, properties={}) {
  const s=normalizeShape(spec);
  return {type:'Feature',properties:{...properties,[SHAPE_KEY]:JSON.stringify(s),_fieldatlas_estimated:s.provenance==='estimated'},geometry:{type:'Polygon',coordinates:[shapeRing(s)]}};
}
export function assertShapeBoundary(spec,geometry,tolerance=1e-6) {
  const expected=shapeRing(spec);
  if(geometry?.type!=='Polygon'||geometry.coordinates.length!==1)throw new Error('圆形参数必须与单环多边形边界同时保存');
  const actual=geometry.coordinates[0];
  if(actual.length!==expected.length)throw new Error('圆形参数与边界不一致；请检查文件，未导入该文件');
  // KML writers may reverse ring orientation or rotate its first vertex.
  let start=expected.findIndex(p=>Math.abs(p[0]-actual[0][0])<=tolerance&&Math.abs(p[1]-actual[0][1])<=tolerance);
  const n=SHAPE_SEGMENTS;
  const match=direction=>actual.every((p,i)=>{const e=expected[(start+direction*(i%n)+n*2)%n];return p.length>=2&&Math.abs(p[0]-e[0])<=tolerance&&Math.abs(p[1]-e[1])<=tolerance;});
  if(start<0||(!match(1)&&!match(-1)))throw new Error('圆形参数与边界不一致；请检查文件，未导入该文件');
}
export function shapeLabel(s) {
  const prefix=s.provenance==='estimated'?'估算':'手工参数';
  return s.kind==='circle'?`${prefix} · r=${(s.radiusMeters/1000).toFixed(3)} km`:`${prefix} · 半轴 ${(s.semiAxisAMeters/1000).toFixed(3)} / ${(s.semiAxisBMeters/1000).toFixed(3)} km`;
}
