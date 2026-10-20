import proj4 from 'proj4';
export const CRS = [
 ['EPSG:4326','WGS84 经纬度 · 经度 / 纬度'],
 ['EPSG:4490','CGCS2000 · 经纬度（底图近似叠加）'],
 ['EPSG:3857','Web Mercator · 东 / 北（米）'],
 ['EPSG:32650','WGS84 / UTM 50N · 东 / 北（米）'],
 ['EPSG:32651','WGS84 / UTM 51N · 东 / 北（米）']
];
for(let zone=1;zone<=60;zone++)for(const south of [false,true])proj4.defs(`EPSG:${south?32700+zone:32600+zone}`,`+proj=utm +zone=${zone} ${south?'+south ':''}+datum=WGS84 +units=m +no_defs`);
// CGCS2000 ellipsoid; no surveyed datum transformation is supplied.
// Cross-datum display is an approximation, not a precision CGCS2000/WGS84 operation.
proj4.defs('EPSG:4490','+proj=longlat +a=6378137 +rf=298.257222101 +no_defs');
export function resolveGeoJSONCRS(obj,fallback='EPSG:4326'){
 if(!obj.crs)return obj.fieldatlas?.version===1&&obj.fieldatlas?.crs==='EPSG:4326'?'EPSG:4326':fallback;
 const name=obj.crs?.type==='name'?obj.crs.properties?.name:null;
 if(typeof name!=='string')throw new Error('不支持的 GeoJSON 坐标系声明，请检查文件 CRS');
 let code;
 if(/(?:^|[:/])CRS84$/i.test(name))code='EPSG:4326';
 else {const match=name.match(/^EPSG:(\d+)$/i)||name.match(/^urn:ogc:def:crs:EPSG:[^:]*:(\d+)$/i)||name.match(/^https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/[^/]*\/(\d+)$/i);if(match)code='EPSG:'+match[1];}
 if(!code||!proj4.defs(code))throw new Error('不支持的文件坐标系：'+name+'。请先添加该 CRS 定义；未导入任何对象。');
 return code;
}
export function convertCoordinate(from,to,xy){
 if(!Array.isArray(xy)||xy.length<2||!xy.every(Number.isFinite))throw new Error('坐标必须是有效数字');
 if(['EPSG:4326','EPSG:4490'].includes(from)&&(Math.abs(xy[0])>180||Math.abs(xy[1])>90))throw new Error('经纬度超出范围');
 if(['EPSG:4326','EPSG:4490'].includes(from)&&to==='EPSG:3857'&&Math.abs(xy[1])>85.05112878)throw new Error('Web Mercator 不支持该纬度');
 const out=proj4(from,to,xy);
 if(!out.every(Number.isFinite))throw new Error('转换结果无效，请检查定义和坐标适用范围');
 return out;
}
export function addCRS(code,definition){
 if(!code||!definition.trim()||definition.length>3000)throw new Error('请输入 CRS 名称与 PROJ 定义');
 if(/\+nadgrids/.test(definition))throw new Error('首版尚未加载格网文件，请使用明确的无格网定义');
 new proj4.Proj(definition);proj4.defs(code,definition);
}
export {proj4};
