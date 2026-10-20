import {putDraft,getDrafts,clearDraft,draftId,contentKey} from './drafts.js';
import 'ol/ol.css';
import './style.css';
import {SHAPE_KEY,normalizeShape,shapeFeature,shapeLabel,assertShapeBoundary} from './shapes.js';
import CircleGeometry from 'ol/geom/Circle.js';
import Map from 'ol/Map.js';import View from 'ol/View.js';import Feature from 'ol/Feature.js';
import TileLayer from 'ol/layer/Tile.js';import VectorLayer from 'ol/layer/Vector.js';import XYZ from 'ol/source/XYZ.js';import VectorSource from 'ol/source/Vector.js';
import Draw,{createBox} from 'ol/interaction/Draw.js';import Modify from 'ol/interaction/Modify.js';import Snap from 'ol/interaction/Snap.js';import Select from 'ol/interaction/Select.js';
import {Style,Fill,Stroke,Circle as CircleStyle,Text} from 'ol/style.js';import {fromLonLat,toLonLat,transformExtent,get as getProjection} from 'ol/proj.js';import {register} from 'ol/proj/proj4.js';import {ScaleLine,defaults as defaultControls} from 'ol/control.js';
import GeoJSON from 'ol/format/GeoJSON.js';import KML from 'ol/format/KML.js';import GPX from 'ol/format/GPX.js';import Point from 'ol/geom/Point.js';import {getArea,getLength,getDistance} from 'ol/sphere.js';
import Papa from 'papaparse';import JSZip from 'jszip';import {CRS,proj4,convertCoordinate,addCRS,resolveGeoJSONCRS} from './coordinates.js';
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();const geo=new GeoJSON();const formatOptions={featureProjection:'EPSG:3857',dataProjection:'EPSG:4326'};
const typeNames={Point:'点',MultiPoint:'多点',LineString:'线',MultiLineString:'多线',Polygon:'面',MultiPolygon:'多面',GeometryCollection:'集合'};
let project,packages=[],ready=false,draw,snap,selected=null,history=[],historyIndex=-1,restoring=false,saveTimer,saveQueue=Promise.resolve(),convertedRows=[],objectsVisible=true,activeTool='select',pickingCenter=false,referenceURL=null,labelsVisible=true;
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'show error':'show';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').className='',error?7000:3800);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});let data;try{data=await r.json();}catch{throw new Error(`请求失败 HTTP ${r.status}`);}if(!r.ok){const error=new Error(data.error||`HTTP ${r.status}`);error.status=r.status;throw error;}return data;}
const source=new VectorSource({wrapX:false}),boxSource=new VectorSource({wrapX:false});
function featureStyle(feature,selectedStyle=false){const color=/^#[0-9a-f]{6}$/i.test(feature.get('color'))?feature.get('color'):'#187c6b';const shape=shapeOf(feature),estimated=shape?.provenance==='estimated'||feature.get('_fieldatlas_estimated')===true;return new Style({stroke:new Stroke({color:selectedStyle?'#ef8945':color,width:selectedStyle?4:2.5,lineDash:estimated?[8,5]:undefined}),fill:new Fill({color:color+(shape?'50':'25')}),image:new CircleStyle({radius:selectedStyle?8:6,fill:new Fill({color}),stroke:new Stroke({color:'#fff',width:2})}),text:new Text({overflow:!!shape,text:(!labelsVisible&&!selectedStyle)?'':(estimated?'[估算] ':'')+String(feature.get('name')||'')+(shape?'\n'+shapeLabel(shape).replace(/^(估算|手工参数) · /,''):''),font:'500 12px -apple-system,sans-serif',offsetY:-17,fill:new Fill({color:'#20382f'}),stroke:new Stroke({color:'#fff',width:3})})});}
const LAYER_KEY='_fieldatlas_layer';
const layerId=f=>typeof f.get(LAYER_KEY)==='string'&&f.get(LAYER_KEY).trim()?f.get(LAYER_KEY):'original';
const layerName=id=>id==='original'?'原始与其他对象':id;
const objectLayers=new globalThis.Map();
let hiddenLayers=new Set();try{hiddenLayers=new Set(JSON.parse(localStorage.getItem('fieldatlas-hidden-layers')||'[]'));}catch{}
const base=new TileLayer(),vector=new VectorLayer({source,declutter:true,style:f=>layerId(f)==='original'?featureStyle(f):undefined}),boxLayer=new VectorLayer({source:boxSource,style:new Style({stroke:new Stroke({color:'#e98d3d',width:2,lineDash:[7,5]}),fill:new Fill({color:'#e98d3d18'})})});
const map=new Map({target:'map',layers:[base,vector,boxLayer],controls:defaultControls({rotate:false,attributionOptions:{collapsible:false}}).extend([new ScaleLine({units:'metric'})]),view:new View({center:fromLonLat([120.145,30.246]),zoom:13,minZoom:2,maxZoom:22,extent:getProjection('EPSG:3857').getExtent(),constrainOnlyCenter:false})});
function mapPadding(preferred=80){const size=map.getSize()||[800,600];const p=Math.max(8,Math.min(preferred,Math.floor(Math.min(...size)*.12)));return [p,p,p,p];}
objectLayers.set('original',vector);
const select=new Select({layers:layer=>[...objectLayers.values()].includes(layer),style:f=>featureStyle(f,true),hitTolerance:7});map.addInteraction(select);
const modify=new Modify({features:select.getFeatures()});map.addInteraction(modify);
select.on('select',()=>{selected=select.getFeatures().item(0)||null;if(selected)setTab('objects');renderObjects();renderEditor();});
modify.on('modifyend',()=>{commit();renderEditor();});
function jsonFeatures(){const obj=geo.writeFeaturesObject(source.getFeatures(),formatOptions);for(const f of obj.features){delete f.properties?.styleUrl;delete f.properties?.Style;delete f.properties?.style;}return obj;}
function snapshot(){return JSON.stringify(jsonFeatures());}
function commit(){if(restoring||!ready)return;const s=snapshot();if(history[historyIndex]!==s){history=history.slice(0,historyIndex+1);history.push(s);if(history.length>70)history.shift();historyIndex=history.length-1;}renderObjects();updateUndo();scheduleSave();}
function updateUndo(){$('undo').disabled=historyIndex<=0;$('redo').disabled=historyIndex>=history.length-1;}
function restoreHistory(direction){if(historyIndex+direction<0||historyIndex+direction>=history.length)return;historyIndex+=direction;restoring=true;select.getFeatures().clear();selected=null;source.clear();source.addFeatures(geo.readFeatures(history[historyIndex],formatOptions));restoring=false;renderObjects();renderEditor();updateUndo();scheduleSave();}
let saveVersion=0,dirty=false,conflict=false,retryTimer,recoveryDraft=null,saveBusy=false;
function payload(){return {...project,features:jsonFeatures(),view:{center:toLonLat(map.getView().getCenter()),zoom:map.getView().getZoom()},name:$('project-name').value};}
function notice(text){$('recovery-message').textContent=text;$('recovery-notice').hidden=!text;}
function scheduleSave(){if(!ready)return;dirty=true;saveVersion++;const token=saveVersion;const p=payload();putDraft({id:draftId,token,at:Date.now(),baseRevision:project._revision,payload:p}).catch(e=>notice('浏览器草稿保存失败，请立即导出项目备份：'+e.message));$('save-state').textContent=conflict?'存在版本冲突 · 草稿保留':'待保存';clearTimeout(saveTimer);if(!conflict)saveTimer=setTimeout(()=>save().catch(e=>toast(e.message,true)),650);}
async function save(){
 if(!ready)return;clearTimeout(saveTimer);const token=saveVersion,p=payload();
 const task=saveQueue.catch(()=>{}).then(async()=>{
  if(conflict)throw Error('存在版本冲突。请先导出当前草稿，再重新载入项目。');
  saveBusy=true;$('save-state').textContent='保存中…';
  await putDraft({id:draftId,token,at:Date.now(),baseRevision:project._revision,payload:p}).catch(e=>notice('浏览器草稿不可用：'+e.message));
  try{const result=await api('/api/project',{method:'PUT',headers:{'If-Match':project._revision||''},body:JSON.stringify(p)});project._revision=result.revision;project.updatedAt=result.updatedAt;
   if(token===saveVersion){dirty=false;$('save-state').textContent=result.backupWarning?'已保存 · 历史备份异常':'已保存到本机';}
   await clearDraft(draftId,token).catch(()=>{});clearTimeout(retryTimer);if(result.backupWarning)notice(result.backupWarning);return {...p,_revision:result.revision,updatedAt:result.updatedAt};
  }catch(e){dirty=true;if(e.status===409){conflict=true;$('save-state').textContent='版本冲突 · 草稿已保留';notice(e.message);}else{$('save-state').textContent='连接中断 · 正在重试';retryTimer=setTimeout(()=>{if(!conflict)save().catch(()=>{});},5000);}throw e;}finally{saveBusy=false;}
 });saveQueue=task;return task;
}
$('defer-recovery').onclick=()=>notice('');
$('export-draft').onclick=()=>{if(ready)download('未保存草稿.field-atlas.json',JSON.stringify(payload(),null,2),'application/json');};
$('recover-draft').onclick=async()=>{if(!recoveryDraft)return;if(!confirm('将恢复所列浏览器草稿。服务器当前版本会进入自动历史备份，是否继续？'))return;try{const p=recoveryDraft.payload,fs=geo.readFeatures(p.features,formatOptions);for(const f of fs)if(shapeOf(f))assertShapeBoundary(shapeOf(f),geo.writeFeatureObject(f,formatOptions).geometry);const rev=project._revision;project={...p,_revision:rev};source.clear();source.addFeatures(fs);select.getFeatures().clear();selected=null;$('project-name').value=p.name;restoreCRS();renderEditor();setBase(p.activeSource||'osm');map.getView().setCenter(fromLonLat(p.view.center));map.getView().setZoom(p.view.zoom);conflict=false;commit();scheduleSave();await save();await clearDraft(recoveryDraft.id,recoveryDraft.token);recoveryDraft=null;$('recover-draft').hidden=true;notice('草稿已恢复并保存。');}catch(e){toast(e.message,true);}};
async function refreshBackups(){const entries=await api('/api/backups');$('history-backup').innerHTML=entries.map(e=>`<option value="${esc(e.id)}">${esc(new Date(e.createdAt).toLocaleString())} · ${e.count} 个对象</option>`).join('');$('download-history').disabled=!entries.length;$('backup-summary').textContent=`${entries.length} 份有效历史备份 · 最多100份，容量上限256MB（至少保留5份）`;}
$('refresh-history').onclick=()=>refreshBackups().catch(e=>toast(e.message,true));
$('download-history').onclick=async()=>{try{const id=$('history-backup').value;if(!id)return;const p=await api('/api/backups/'+encodeURIComponent(id));download('历史项目-'+id,JSON.stringify(p,null,2),'application/json');}catch(e){toast(e.message,true);}};
window.addEventListener('online',()=>{if(ready&&dirty&&!conflict)save().catch(()=>{});});
map.on('moveend',()=>{$('zoom-level').textContent=`Z ${map.getView().getZoom().toFixed(1)}`;scheduleSave();});
map.on('pointermove',e=>{const p=toLonLat(e.coordinate);$('mouse-position').textContent=`经度 ${p[0].toFixed(5)}° · 纬度 ${p[1].toFixed(5)}°`;});
function setPanelOpen(open){$('app').classList.toggle('panel-collapsed',!open);$('workspace-panel').inert=!open;$('toggle-panel').textContent=open?'收起面板':'展开面板';$('toggle-panel').setAttribute('aria-expanded',String(open));requestAnimationFrame(()=>map.updateSize());}
$('toggle-panel').onclick=()=>setPanelOpen($('app').classList.contains('panel-collapsed'));
$('toggle-labels').onclick=()=>{labelsVisible=!labelsVisible;$('toggle-labels').setAttribute('aria-pressed',String(labelsVisible));source.changed();};
$('quick-import').onclick=$('object-import').onclick=()=>{setTab('files');$('choose-import').click();};
$('close-selection').onclick=()=>{select.getFeatures().clear();selected=null;renderEditor();renderObjects();};
function setTab(tab){setPanelOpen(true);document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-pressed',String(b.dataset.tab===tab));});document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.tab==='shapes'&&shapeOf(selected))openShapeEditor();else setTab(b.dataset.tab);});
function setTool(tool){if(draw){map.removeInteraction(draw);draw=null;}if(snap){map.removeInteraction(snap);snap=null;}activeTool=tool;pickingCenter=tool==='pick-center';select.setActive(tool==='select');modify.setActive(tool==='select'&&!shapeOf(selected));document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});$('draw-hint').hidden=tool==='select';
 if(tool==='select')return;
 if(tool==='pick-center'){$('draw-hint').textContent='单击地图，设置覆盖区中心 · Esc 取消';return;}
 select.getFeatures().clear();selected=null;renderEditor();
 const box=tool==='box',ellipse=tool==='Ellipse';let circleEdge;
 const circleFunction=(coords,g)=>{const c=coords[0],end=coords.at(-1);circleEdge=[...end];const radius=Math.hypot(end[0]-c[0],end[1]-c[1]);if(g)g.setCenterAndRadius(c,radius);else g=new CircleGeometry(c,radius);return g;};
 draw=new Draw({source:box?boxSource:source,type:box||ellipse?'Circle':tool,geometryFunction:box||ellipse?createBox():tool==='Circle'?circleFunction:undefined,stopClick:true});map.addInteraction(draw);snap=new Snap({source});map.addInteraction(snap);
 $('draw-hint').textContent=tool==='Circle'?'先点击圆心，再点击边缘 · 创建估算圆':ellipse?'点击两个对角点框选椭圆 · 创建估算区域':box?'单击角点，再单击对角点，选取离线区域 · Esc 取消':tool==='Point'?'点击地图添加点 · Esc 退出':'单击添加顶点，双击结束 · Esc 取消';
 if(box)boxSource.clear();
 draw.on('drawend',e=>{if(box){const b=transformExtent(e.feature.getGeometry().getExtent(),'EPSG:3857','EPSG:4326');$('offline-bounds').value=b.map(x=>x.toFixed(6)).join(',');setTimeout(()=>{setTool('select');estimate().catch(e=>toast(e.message,true));},0);}else{if(tool==='Circle'||ellipse){try{let spec;const g=e.feature.getGeometry();if(tool==='Circle'){const center=toLonLat(g.getCenter());spec={version:1,kind:'circle',center,radiusMeters:getDistance(center,toLonLat(circleEdge)),rotationDeg:0,provenance:'estimated',note:'在地图手绘估算，待核对'};}else{const ex=g.getExtent(),c=[(ex[0]+ex[2])/2,(ex[1]+ex[3])/2],center=toLonLat(c);spec={version:1,kind:'ellipse',center,semiAxisAMeters:getDistance(center,toLonLat([ex[2],c[1]])),semiAxisBMeters:getDistance(center,toLonLat([c[0],ex[3]])),rotationDeg:90,provenance:'estimated',note:'框选范围估算，待核对'};}applyShape(e.feature,spec);e.feature.setId(uid());e.feature.setProperties({name:ellipse?'估算椭圆':'估算圆',color:'#c7a600'});setTimeout(()=>{commit();chooseFeature(e.feature);openShapeEditor();},0);}catch(err){setTimeout(()=>{source.removeFeature(e.feature);setTool('select');toast(err.message,true);},0);}return;}e.feature.setId(uid());e.feature.setProperties({name:`新建${typeNames[tool]||'对象'}`,color:'#187c6b'});setTimeout(()=>{commit();setTool('select');chooseFeature(e.feature);},0);}});
}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function chooseFeature(f){if(hiddenLayers.has(layerId(f))||!objectsVisible){toast('请先显示该对象所在图层');return;}setTool('select');select.getFeatures().clear();select.getFeatures().push(f);selected=f;setTab('objects');renderObjects();renderEditor();}
function layerFeatures(id){return source.getFeatures().filter(f=>layerId(f)===id);}
function renderLayers(){
 const ids=['original',...new Set(source.getFeatures().map(layerId).filter(id=>id!=='original'))];
 for(const [id,layer] of objectLayers)if(!ids.includes(id)){map.removeLayer(layer);objectLayers.delete(id);}
 for(const id of ids){if(!objectLayers.has(id)){const layer=new VectorLayer({source,declutter:true,style:f=>layerId(f)===id?featureStyle(f):undefined});map.getLayers().insertAt(map.getLayers().getLength()-1,layer);objectLayers.set(id,layer);}objectLayers.get(id).setVisible(objectsVisible&&!hiddenLayers.has(id));}
 const filter=$('object-layer-filter').value,exportScope=$('export-scope').value;
 $('object-layer-filter').innerHTML='<option value="all">全部图层</option>'+ids.map(id=>`<option value="${esc(id)}">${esc(layerName(id))}</option>`).join('');
 if(ids.includes(filter))$('object-layer-filter').value=filter;
 $('export-scope').innerHTML='<option value="all">全部对象</option><option value="selected">当前选中对象</option>'+ids.map(id=>`<option value="layer:${esc(id)}">图层：${esc(layerName(id))}</option>`).join('');
 if([...$('export-scope').options].some(o=>o.value===exportScope))$('export-scope').value=exportScope;
 $('object-layers').replaceChildren();
 for(const id of ids){const row=document.createElement('div');row.className='object-layer-row';const label=document.createElement('label');label.className='check';const check=document.createElement('input');check.type='checkbox';check.checked=objectsVisible&&!hiddenLayers.has(id);check.setAttribute('aria-label','显示图层：'+layerName(id));label.append(check,document.createTextNode(layerName(id)+' · '+layerFeatures(id).length));
 check.onchange=()=>{if(check.checked){hiddenLayers.delete(id);objectsVisible=true;}else hiddenLayers.add(id);try{localStorage.setItem('fieldatlas-hidden-layers',JSON.stringify([...hiddenLayers]));}catch{}if(selected&&(!objectsVisible||hiddenLayers.has(layerId(selected)))){select.getFeatures().clear();selected=null;renderEditor();}renderObjects();};
 const locate=document.createElement('button');locate.textContent='定位';locate.setAttribute('aria-label','定位图层：'+layerName(id));locate.onclick=()=>{const fs=layerFeatures(id);if(!fs.length)return;hiddenLayers.delete(id);objectsVisible=true;try{localStorage.setItem('fieldatlas-hidden-layers',JSON.stringify([...hiddenLayers]));}catch{}renderObjects();const extent=new VectorSource({features:fs}).getExtent();map.getView().fit(extent,{padding:mapPadding(),maxZoom:16,duration:350});};row.append(label,locate);$('object-layers').append(row);}
 $('toggle-objects').textContent=objectsVisible?'隐藏全部对象':'显示全部对象';
}
$('object-layer-filter').onchange=renderObjects;
function renderObjects(){renderLayers();const features=source.getFeatures().sort((a,b)=>String(a.get('name')||'').localeCompare(String(b.get('name')||''),'zh-CN',{numeric:true})),q=$('object-search').value.trim().toLowerCase();$('object-count').textContent=features.length;$('feature-summary').textContent=`${features.length} 个对象`;$('object-list').innerHTML='';
 const filtered=features.filter(f=>($('object-layer-filter').value==='all'||layerId(f)===$('object-layer-filter').value)&&String(f.get('name')||'未命名').toLowerCase().includes(q));
 if(!filtered.length)$('object-list').innerHTML=`<div class="empty"><b>${features.length?'没有匹配的对象':'当前没有对象'}</b><p>可从文件导入，或使用地图工具绘制。</p></div>`;
 for(const f of filtered){const item=document.createElement('button');item.className='object-item'+(selected===f?' selected':'');item.title=String(f.get('name')||'未命名');item.style.setProperty('--object-color',/^#[0-9a-f]{6}$/i.test(f.get('color'))?f.get('color'):'#187c6b');item.setAttribute('aria-pressed',String(selected===f));item.innerHTML=`<span class="object-type">${esc(shapeOf(f)?.kind==='circle'?'圆':shapeOf(f)?.kind==='ellipse'?'椭圆':typeNames[f.getGeometry()?.getType()]||'对象')}</span><span><b>${esc(f.get('name')||'未命名')}</b><small>${esc(shapeOf(f)?shapeLabel(shapeOf(f)):f.get('description')||'本地对象')}</small></span>`;item.onclick=()=>chooseFeature(f);item.ondblclick=()=>map.getView().fit(f.getGeometry().getExtent(),{padding:mapPadding(90),maxZoom:17,duration:350});$('object-list').append(item);}}
function renderEditor(){$('selection-editor').hidden=!selected;document.querySelector('[data-panel="objects"]').classList.toggle('has-selection',!!selected);const shape=shapeOf(selected);$('edit-shape').hidden=!shape;$('update-shape').disabled=!shape;$('create-shape').classList.toggle('primary',!shape);$('update-shape').classList.toggle('primary',!!shape);$('shape-editing').textContent=shape?'选中：'+(selected.get('name')||'未命名'):'未选中覆盖区';modify.setActive(activeTool==='select'&&!shape);if(!selected)return;$('edit-mode-hint').textContent=shape?'圆与椭圆通过参数编辑；边界顶点锁定，避免破坏形状。':'选中后拖动顶点；Alt + 单击顶点删除。撤销可恢复编辑。';$('feature-name').value=selected.get('name')||'';$('feature-description').value=selected.get('description')||'';$('feature-color').value=/^#[0-9a-f]{6}$/i.test(selected.get('color'))?selected.get('color'):'#187c6b';const g=selected.getGeometry(),t=g.getType();let metric=typeNames[t]||t;if(/Polygon/.test(t)){const a=getArea(g);metric+=` · ${a>1e6?(a/1e6).toFixed(3)+' km²':a.toFixed(1)+' m²'}`;}else if(/LineString/.test(t)){const l=getLength(g);metric+=` · ${l>1000?(l/1000).toFixed(3)+' km':l.toFixed(1)+' m'}`;}else if(t==='Point'){metric+=' · '+toLonLat(g.getCoordinates()).map(n=>n.toFixed(6)).join(', ');} $('feature-metrics').textContent=shape?shapeLabel(shape)+' · '+metric:metric;const p={...selected.getProperties()};delete p.geometry;delete p.name;delete p.description;delete p.color;$('feature-properties').textContent=JSON.stringify(p,null,2);}
for(const [id,key] of [['feature-name','name'],['feature-description','description'],['feature-color','color']])$(id).addEventListener('change',()=>{if(selected){selected.set(key,$(id).value);commit();renderEditor();}});
$('locate-feature').onclick=()=>{if(selected)map.getView().fit(selected.getGeometry().getExtent(),{padding:mapPadding(60),maxZoom:17,duration:350});};
$('object-search').oninput=renderObjects;$('delete-feature').onclick=()=>{if(selected){source.removeFeature(selected);select.getFeatures().clear();selected=null;renderEditor();commit();}};
$('clear-objects').onclick=()=>{if(source.getFeatures().length&&confirm('清空所有对象？仍可使用撤销恢复。')){source.clear();select.getFeatures().clear();selected=null;renderEditor();commit();}};
$('toggle-objects').onclick=()=>{objectsVisible=!objectsVisible;if(!objectsVisible){select.getFeatures().clear();selected=null;renderEditor();}renderObjects();};
$('fit-all').onclick=()=>{if(source.getFeatures().length)map.getView().fit(source.getExtent(),{padding:mapPadding(80),maxZoom:16,duration:400});else toast('请先添加或导入对象');};
$('undo').onclick=()=>restoreHistory(-1);$('redo').onclick=()=>restoreHistory(1);$('north-button').onclick=()=>map.getView().animate({rotation:0,duration:250});$('project-name').onchange=scheduleSave;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){draw?.abortDrawing();setTool('select');}if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restoreHistory(e.shiftKey?1:-1);}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('delete-feature').click();}});
function attributionHTML(text){return esc(text).replace(/https:\/\/[a-zA-Z0-9./_-]+/g,url=>`<a href="${url}" target="_blank" rel="noopener">${url.includes('creativecommons.org')?'CC BY 4.0':url.includes('maps.eox.at')?'EOX Maps':url.includes('s2maps.eu')?'S2 maps':url==='https://eox.at'?'EOX':url}</a>`);}
function setBase(id,fit=false){const p=packages.find(p=>'pack-'+p.id===id),s=p?{...p,id,minZoom:p.minZoom,maxZoom:p.maxZoom}:project.sources.find(s=>s.id===id);if(!s)return;project.activeSource=id;let url=s.id==='osm'?s.url:`/api/tiles/${encodeURIComponent(id)}/{z}/{x}/{y}`;const xyz=new XYZ({url,minZoom:s.minZoom,maxZoom:s.maxZoom,attributions:s.id==='osm'?'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>':attributionHTML(s.attribution||''),wrapX:false});let errors=0;xyz.on('tileloaderror',()=>{errors++;if(errors>1){$('map-message').hidden=false;$('map-message').textContent=p?'当前视野或级别没有已保存瓦片，可定位到离线范围。':'底图暂不可用。检查图源地址或切换到离线演练底图。';}});xyz.on('tileloadend',()=>{errors=0;$('map-message').hidden=true;});base.setSource(xyz);base.setExtent(p?transformExtent(p.bounds,'EPSG:4326','EPSG:3857'):undefined);$('map-message').hidden=true;$('layer-name').textContent=s.name.replace(/ · 在线$/,'');$('map-mode').textContent=p?'离线':s.id==='demo'?'演练底图':'在线';$('offline-banner').hidden=!p;if(p)$('offline-banner').textContent=`离线 · Z${p.minZoom}–${p.maxZoom} · 范围外无影像`;if(p&&fit)map.getView().fit(transformExtent(p.bounds,'EPSG:4326','EPSG:3857'),{padding:mapPadding(70),maxZoom:p.maxZoom,duration:400});renderSources();if(s.offlineAllowed&&!p)$('offline-source').value=s.id;else if(p?.sourceId&&project.sources.some(x=>x.id===p.sourceId&&x.offlineAllowed))$('offline-source').value=p.sourceId;scheduleSave();}
$('add-satellite').onclick=async()=>{try{const presets=await api('/api/source-presets'),s=presets.find(s=>s.id==='sentinel-2016');if(!s)throw Error('当前服务尚未提供卫星图源预设');if(!project.sources.some(x=>x.id===s.id))project.sources.push(s);await save();setBase(s.id);toast('已切换到2016/17历史卫星影像');}catch(e){toast(e.message,true);}};
$('offline-objects').onclick=()=>{if(!source.getFeatures().length){toast('当前没有地图对象');return;}const b=transformExtent(source.getExtent(),'EPSG:3857','EPSG:4326').map((x,i)=>x+(i<2?-.015:.015));$('offline-bounds').value=b.map(n=>n.toFixed(6)).join(',');estimate().catch(e=>toast(e.message,true));};
function renderSources(){$('source-list').innerHTML=project.sources.map(s=>`<div class="source-card ${project.activeSource===s.id?'selected':''}"><button data-use-source="${esc(s.id)}"><span class="source-dot"></span><b>${esc(s.name)}</b><small>${s.offlineAllowed?'可离线保存':'在线浏览'} · ${s.scheme.toUpperCase()}</small></button>${s.note?`<p class="hint source-note">${esc(s.note)}</p>`:''}${!s.builtin?`<div class="source-actions"><button data-edit-source="${esc(s.id)}">编辑</button><button data-delete-source="${esc(s.id)}">删除</button></div>`:''}</div>`).join('');
 $('source-list').querySelectorAll('[data-use-source]').forEach(b=>b.onclick=()=>setBase(b.dataset.useSource));
 $('source-list').querySelectorAll('[data-edit-source]').forEach(b=>b.onclick=()=>{const s=project.sources.find(s=>s.id===b.dataset.editSource);$('source-id').value=s.id;$('source-name').value=s.name;$('source-url').value=s.url;$('source-max').value=s.maxZoom;$('source-scheme').value=s.scheme;$('source-credit').value=s.attribution;$('source-offline').checked=s.offlineAllowed;$('source-form-title').textContent='编辑图源';});
 $('source-list').querySelectorAll('[data-delete-source]').forEach(b=>b.onclick=()=>{const id=b.dataset.deleteSource;project.sources=project.sources.filter(s=>s.id!==id);if(project.activeSource===id)setBase('osm');renderSources();scheduleSave();});
 const old=$('offline-source').value;$('offline-source').innerHTML=project.sources.filter(s=>s.offlineAllowed).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');if(project.sources.some(s=>s.id===old&&s.offlineAllowed))$('offline-source').value=old;
}
$('source-reset').onclick=()=>{$('source-form').reset();$('source-id').value='';$('source-form-title').textContent='添加图源';};
$('source-form').onsubmit=async e=>{e.preventDefault();try{const s={id:$('source-id').value||uid(),name:$('source-name').value,url:$('source-url').value.trim(),scheme:$('source-scheme').value,minZoom:0,maxZoom:Number($('source-max').value),attribution:$('source-credit').value,offlineAllowed:$('source-offline').checked};if(!['{x}','{y}','{z}'].every(k=>s.url.includes(k)))throw new Error('URL 必须包含 {z}、{x}、{y}');const before=project.sources;project.sources=[...before.filter(x=>x.id!==s.id),s];try{await save();}catch(err){project.sources=before;throw err;}project=(await api('/api/project'));setBase(s.id);$('source-reset').click();toast('图源已保存并切换');}catch(e){toast(e.message,true);}};
function normalizeFeature(f,index=0){if(f.get(SHAPE_KEY)){const spec=normalizeShape(f.get(SHAPE_KEY));const obj=geo.writeFeatureObject(f,formatOptions);assertShapeBoundary(spec,obj.geometry);f.set(SHAPE_KEY,JSON.stringify(spec));f.set('_fieldatlas_estimated',spec.provenance==='estimated');}const g=f.getGeometry();if(!g)throw new Error('文件包含无几何对象');const extent=g.getExtent();if(!extent.every(Number.isFinite)||extent[1]<-21000000||extent[3]>21000000)throw new Error('坐标超出可显示范围，请确认输入坐标系');f.setId(uid());if(!f.get('name'))f.set('name',`导入${typeNames[g.getType()]||'对象'} ${index+1}`);if(!f.get('color'))f.set('color','#187c6b');f.setStyle(undefined);return f;}
async function importFile(file){if(!file)return;if(file.size>30*1024*1024)throw new Error('标准文件首版限制 30 MB');const ext=file.name.split('.').pop().toLowerCase();let text,features,importCRS=null;
 if(ext==='kmz'){const zip=await JSZip.loadAsync(await file.arrayBuffer());const entries=Object.values(zip.files).filter(f=>!f.dir&&f.name.toLowerCase().endsWith('.kml'));if(!entries.length)throw new Error('KMZ 中没有 KML');const k=entries.find(f=>f.name.toLowerCase()==='doc.kml')||entries[0];if(k._data?.uncompressedSize>30*1024*1024)throw new Error('解压后的 KML 超过 30 MB');text=await k.async('string');if(entries.length>1)toast('KMZ 包含多个 KML：本次读取 '+k.name);}
 else text=await file.text();
 if(['kml','kmz','gpx'].includes(ext)){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('XML 文件格式无效');features=(ext==='gpx'?new GPX():new KML({extractStyles:false})).readFeatures(doc,formatOptions);}
 else if(ext==='csv'){const result=Papa.parse(text,{header:true,skipEmptyLines:'greedy'});if(result.errors.length)throw new Error('CSV 格式错误：'+result.errors[0].message);const keys=result.meta.fields||[];const x=keys.find(k=>['lon','lng','longitude','x','经度','东坐标'].includes(k.trim().toLowerCase()));const y=keys.find(k=>['lat','latitude','y','纬度','北坐标'].includes(k.trim().toLowerCase()));if(!x||!y)throw new Error('CSV 需要 lon/lat、x/y 或 经度/纬度 列');features=result.data.map((row,i)=>{if(row[x].trim()===''||row[y].trim()==='')throw new Error(`CSV 第 ${i+2} 行缺少坐标`);const xy=convertCoordinate($('import-crs').value,'EPSG:3857',[Number(row[x]),Number(row[y])]);const f=new Feature({geometry:new Point(xy),...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='geometry'))});return f;});}
 else {const obj=JSON.parse(text);if(obj.version===1&&obj.sources)throw new Error('这是项目备份，请使用“恢复项目备份”');importCRS=resolveGeoJSONCRS(obj,$('import-crs').value);register(proj4);features=geo.readFeatures(obj,{featureProjection:'EPSG:3857',dataProjection:importCRS});}
 if(importCRS&&importCRS!=='EPSG:4326'&&features.some(f=>f.get(SHAPE_KEY)))throw new Error('野图圆形参数需使用 WGS84 GeoJSON，请勿同时声明其他坐标系');
 if(!features.length)throw new Error('没有可导入的几何对象');if(source.getFeatures().length+features.length>50000)throw new Error('对象总数超过 50000');features=features.map(normalizeFeature);if(importCRS){if(!Array.from($('import-crs').options).some(o=>o.value===importCRS))$('import-crs').add(new Option(importCRS,importCRS));$('import-crs').value=importCRS;for(const f of features)f.set('_fieldatlas_source_crs',importCRS);}$('import-note').textContent=importCRS==='EPSG:4490'?'已识别 CGCS2000（EPSG:4490）。在 WGS84 底图上的叠加采用近似处理，未进行工程精度校验。':importCRS?'输入坐标系：'+importCRS:'';source.addFeatures(features);commit();$('fit-all').click();toast(`已导入 ${features.length} 个对象`);}
$('import-file').onchange=async e=>{try{await importFile(e.target.files[0]);}catch(err){toast(err.message,true);}e.target.value='';};
function download(name,data,type='text/plain'){const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('export-data').onclick=async()=>{try{const scope=$('export-scope').value,fs=scope==='selected'?(selected?[selected]:[]):scope.startsWith('layer:')?layerFeatures(scope.slice(6)):source.getFeatures();if(!fs.length)throw new Error('没有可导出的对象');const fmt=$('export-format').value,name=($('project-name').value||'野图对象').replace(/[\\/]/g,'_');let data;
 if(fmt==='geojson'){const exported=geo.writeFeaturesObject(fs,{...formatOptions,decimals:8});exported.fieldatlas={version:1,crs:'EPSG:4326'};data=JSON.stringify(exported);}
 if(fmt==='kml'||fmt==='kmz'){data=new KML({writeStyles:false}).writeFeatures(fs,formatOptions);if(fmt==='kmz'){const z=new JSZip();z.file('doc.kml',data);data=await z.generateAsync({type:'blob',compression:'DEFLATE'});}}
 if(fmt==='gpx'){if(fs.some(f=>!['Point','LineString','MultiLineString'].includes(f.getGeometry().getType())))throw new Error('GPX 仅支持点与线，请选中点/线导出，或改用 GeoJSON/KML 保存面');data=new GPX().writeFeatures(fs,formatOptions);}
 if(fmt==='csv'){if(fs.some(f=>f.getGeometry().getType()!=='Point'))throw new Error('CSV 仅支持点；请选中点导出，或改用 GeoJSON');const crs=$('export-crs').value;data=Papa.unparse(fs.map(f=>{const c=convertCoordinate('EPSG:3857',crs,f.getGeometry().getCoordinates().slice(0,2));const props={...f.getProperties()};delete props.geometry;return {...props,x:c[0],y:c[1],crs};}),{escapeFormulae:true});data='\ufeff'+data;}
 download(name+'.'+fmt,data,fmt==='geojson'?'application/geo+json':'application/octet-stream');toast(`已导出 ${fs.length} 个对象`);}catch(e){toast(e.message,true);}};
$('backup-project').onclick=async()=>{try{let p;try{p=await save();}catch{p=payload();toast('连接异常，已导出当前窗口草稿');}download(($('project-name').value||'野图')+'.field-atlas.json',JSON.stringify(p,null,2),'application/json');}catch(e){toast(e.message,true);}};
$('restore-project').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const p=JSON.parse(await f.text());if(p.version!==1||!p.features||!Array.isArray(p.sources))throw new Error('不是野图项目备份');if(!confirm('恢复将替换当前对象、图源和视图。建议先备份当前项目。'))return;const features=geo.readFeatures(p.features,formatOptions).map((f,i)=>{normalizeFeature(f.clone(),i);return f;});const result=await api('/api/project',{method:'PUT',headers:{'If-Match':project._revision||''},body:JSON.stringify(p)});project={...p,_revision:result.revision};source.clear();source.addFeatures(features);select.getFeatures().clear();selected=null;$('project-name').value=p.name;renderEditor();renderSources();restoreCRS();map.getView().setCenter(fromLonLat(p.view?.center||[120.145,30.246]));map.getView().setZoom(p.view?.zoom||13);setBase(p.activeSource||'osm');commit();toast('项目已恢复');}catch(err){toast(err.message,true);}e.target.value='';};
function crsOptions(){return [...CRS,...(project?.customCRS||[]).map(x=>[x.code,x.code])];}
function renderCRS(){document.querySelectorAll('.crs-select').forEach(s=>{const old=s.value;s.innerHTML=crsOptions().map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');if(crsOptions().some(x=>x[0]===old))s.value=old;});}
function restoreCRS(){for(const x of project.customCRS||[])try{addCRS(x.code,x.definition);}catch{}register(proj4);renderCRS();}
$('add-crs').onclick=()=>{try{const code=$('custom-crs-code').value.trim(),definition=$('custom-crs-def').value.trim();if(CRS.some(x=>x[0]===code))throw new Error('不能覆盖内置坐标系');addCRS(code,definition);project.customCRS=[...(project.customCRS||[]).filter(x=>x.code!==code),{code,definition}];register(proj4);renderCRS();$('coord-to').value=code;scheduleSave();toast('坐标定义已添加');}catch(e){toast(e.message,true);}};
$('use-center').onclick=()=>{$('coord-from').value='EPSG:4326';$('coord-input').value=toLonLat(map.getView().getCenter()).map(x=>x.toFixed(8)).join(', ');};
$('swap-crs').onclick=()=>{const x=$('coord-from').value;$('coord-from').value=$('coord-to').value;$('coord-to').value=x;};
$('convert-coords').onclick=()=>{try{const lines=$('coord-input').value.trim().split(/\n/).filter(Boolean);if(!lines.length||!lines[0])throw new Error('请输入坐标');if(lines.length>10000)throw new Error('单次最多 10000 行');convertedRows=lines.map((line,i)=>{const a=line.trim().split(/[,，\s]+/);if(a.length!==2)throw new Error(`第 ${i+1} 行需两个坐标值`);const out=convertCoordinate($('coord-from').value,$('coord-to').value,a.map(Number));return {x:out[0],y:out[1],crs:$('coord-to').value};});$('coord-warning').textContent=[$('coord-from').value,$('coord-to').value].includes('EPSG:4490')&&$('coord-from').value!==$('coord-to').value?'涉及 CGCS2000 的跨基准转换采用近似处理，未提供实测基准转换参数；不能据此认定工程精度。':'';$('coord-result').textContent=convertedRows.map(r=>`${r.x.toFixed(8)}, ${r.y.toFixed(8)}`).join('\n');}catch(e){convertedRows=[];$('coord-result').textContent=e.message;toast(e.message,true);}};
$('download-coords').onclick=()=>{if(convertedRows.length)download('坐标转换.csv','\ufeff'+Papa.unparse(convertedRows),'text/csv');else toast('请先转换坐标');};
function offlineParams(){return {bounds:$('offline-bounds').value.split(/[,，\s]+/).filter(Boolean).map(Number),minZoom:Number($('offline-min').value),maxZoom:Number($('offline-max').value),sourceId:$('offline-source').value,name:$('offline-name').value};}
async function estimate(){const r=await api('/api/packages/estimate',{method:'POST',body:JSON.stringify(offlineParams())});$('offline-estimate-text').textContent=r.total.toLocaleString()+' 张瓦片';return r;}
$('offline-select').onclick=()=>{setTool('box');toast('在地图上点击两个角点选定范围');};
$('offline-viewport').onclick=()=>{const b=transformExtent(map.getView().calculateExtent(map.getSize()),'EPSG:3857','EPSG:4326');$('offline-bounds').value=b.map((n,i)=>Math.max(i%2?-85:-180,Math.min(i%2?85:180,n)).toFixed(6)).join(',');estimate().catch(e=>toast(e.message,true));};
$('offline-estimate').onclick=()=>estimate().catch(e=>toast(e.message,true));
$('offline-form').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;try{btn.disabled=true;await save();await api('/api/packages',{method:'POST',body:JSON.stringify(offlineParams())});await refreshPackages();toast('离线包任务已创建');}catch(e){toast(e.message,true);}finally{btn.disabled=false;}};
const statusNames={complete:'已就绪',downloading:'下载中',queued:'等待中',paused:'已暂停',error:'有失败 · 可重试'};
async function refreshPackages(){packages=await api('/api/packages');$('package-list').innerHTML=packages.length?'':'<div class="empty small">还没有离线包。<br>框选区域下载，或导入 MBTiles。</div>';for(const p of packages){const div=document.createElement('div');div.className='package-card';const percent=p.total?Math.min(100,Math.round(p.done/p.total*100)):0;div.innerHTML=`<div class="package-head"><b>${esc(p.name)}</b><span>${statusNames[p.status]||esc(p.status)}</span></div><progress max="100" value="${percent}"></progress><small>${p.done} / ${p.total} 张 · ${((p.bytes||0)/1048576).toFixed(1)} MB · Z${p.minZoom}–${p.maxZoom}</small>${p.error?`<p class="error-text">${esc(p.error)}</p>`:''}<div class="package-actions"><button data-action="use">使用</button>${p.status==='downloading'?'<button data-action="pause">暂停</button>':!p.imported&&p.status!=='complete'?'<button data-action="resume">继续 / 重试</button>':''}<button data-action="export">导出</button><button data-action="delete">删除</button></div>`;div.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{try{const a=b.dataset.action;if(a==='use'){setBase('pack-'+p.id,true);return;}if(a==='export'){if(p.status==='downloading')throw new Error('请先暂停下载再导出');downloadPackage(p);return;}if(a==='delete'){if(!confirm(`删除离线包“${p.name}”？此操作不可撤销。`))return;await api('/api/packages/'+p.id,{method:'DELETE'});if(project.activeSource==='pack-'+p.id)setBase('demo');}else await api(`/api/packages/${p.id}/${a}`,{method:'POST'});await refreshPackages();}catch(e){toast(e.message,true);}});$('package-list').append(div);}}
function downloadPackage(p){const a=document.createElement('a');a.href=`/api/packages/${p.id}/export`;a.download=p.name+'.mbtiles';a.click();}
$('import-mbtiles').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;toast('正在检查并导入离线包…');const form=new FormData();form.append('file',f);const p=await api('/api/packages-import',{method:'POST',body:form});await refreshPackages();setBase('pack-'+p.id,true);toast('离线包已导入，可断网使用');}catch(err){toast(err.message,true);}e.target.value='';};
$('load-sample').onclick=async()=>{try{const r=await fetch('/samples/westlake.geojson');const fs=geo.readFeatures(await r.json(),formatOptions).map(normalizeFeature);source.addFeatures(fs);commit();$('fit-all').click();toast('已载入 3 个示例对象，可编辑或删除');}catch(e){toast(e.message,true);}};
$('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=$('help-done').onclick=()=>$('help-dialog').close();
window.addEventListener('beforeunload',e=>{if($('save-state').textContent!=='已保存到本机'&&ready){e.preventDefault();e.returnValue='';}});
function shapeOf(feature) {
  if(!feature?.get(SHAPE_KEY))return null;
  try{return normalizeShape(feature.get(SHAPE_KEY));}catch{return null;}
}
function applyShape(feature,spec) {
  const json=shapeFeature(spec),geometry=geo.readGeometry(json.geometry,formatOptions);
  feature.setGeometry(geometry);feature.set(SHAPE_KEY,json.properties[SHAPE_KEY]);
  feature.set('_fieldatlas_estimated',json.properties._fieldatlas_estimated);
}
function syncShapeFields() {
  const ellipse=$('shape-kind').value==='ellipse';
  $('ellipse-rows').hidden=!ellipse;$('circle-radius-row').hidden=ellipse;$('shape-radius').disabled=ellipse;for(const id of ['shape-axis-a','shape-axis-b','shape-rotation'])$(id).disabled=!ellipse;
}
function fillShapeFields(spec,name) {
  $('shape-kind').value=spec.kind;$('shape-lon').value=spec.center[0].toFixed(8);$('shape-lat').value=spec.center[1].toFixed(8);
  if(spec.kind==='circle')$('shape-radius').value=spec.radiusMeters.toFixed(3);
  else {$('shape-axis-a').value=spec.semiAxisAMeters.toFixed(3);$('shape-axis-b').value=spec.semiAxisBMeters.toFixed(3);}
  $('shape-rotation').value=spec.rotationDeg;$('shape-provenance').value=spec.provenance;$('shape-note').value=spec.note;
  if(name)$('shape-name').value=name;syncShapeFields();
}
function openShapeEditor() {
  const shape=shapeOf(selected);if(!shape)return;
  fillShapeFields(shape,selected.get('name'));$('shape-editing').textContent='正在编辑：'+(selected.get('name')||'未命名');
  $('update-shape').disabled=false;setTab('shapes');
}
function readShapeFields() {
  if(!$('shape-lon').value.trim()||!$('shape-lat').value.trim())throw new Error('请先拾取或输入中心坐标');
  return normalizeShape({version:1,kind:$('shape-kind').value,center:[$('shape-lon').value,$('shape-lat').value].map(Number),radiusMeters:Number($('shape-radius').value),semiAxisAMeters:Number($('shape-axis-a').value),semiAxisBMeters:Number($('shape-axis-b').value),rotationDeg:Number($('shape-rotation').value),provenance:$('shape-provenance').value,note:$('shape-note').value});
}
$('shape-kind').onchange=syncShapeFields;
$('edit-shape').onclick=openShapeEditor;
$('draw-circle').onclick=()=>setTool('Circle');$('draw-ellipse').onclick=()=>setTool('Ellipse');
$('pick-shape-center').onclick=()=>setTool('pick-center');
map.on('singleclick',e=>{
  if(!pickingCenter)return;const c=toLonLat(e.coordinate);$('shape-lon').value=c[0].toFixed(8);$('shape-lat').value=c[1].toFixed(8);pickingCenter=false;setTimeout(()=>{setTool('select');setTab('shapes');},0);
});
$('use-point-center').onclick=()=>{
  if(selected?.getGeometry()?.getType()!=='Point'){toast('请在“对象”中先选中一个点，再使用它作为中心',true);return;}
  const c=toLonLat(selected.getGeometry().getCoordinates());$('shape-lon').value=c[0].toFixed(8);$('shape-lat').value=c[1].toFixed(8);
  $('shape-provenance').value='estimated';$('shape-note').value='以选中点“'+(selected.get('name')||'未命名')+'”为中心手工创建，待核对';
};
$('shape-form').onsubmit=e=>{
  e.preventDefault();try {
    const spec=readShapeFields(),f=new Feature();applyShape(f,spec);f.setId(uid());f.setProperties({name:$('shape-name').value.trim()||'覆盖区',color:'#c7a600',description:spec.note});
    source.addFeature(f);commit();chooseFeature(f);openShapeEditor();map.getView().fit(f.getGeometry().getExtent(),{padding:mapPadding(100),maxZoom:17,duration:300});toast('已创建'+(spec.provenance==='estimated'?'估算':'手工参数')+'覆盖区');
  }catch(err){toast(err.message,true);}
};
$('update-shape').onclick=()=>{
  if(!shapeOf(selected)){toast('请先选中一个圆或椭圆',true);return;}
  try {const spec=readShapeFields();applyShape(selected,spec);selected.set('name',$('shape-name').value.trim()||'覆盖区');selected.set('description',spec.note);commit();renderEditor();openShapeEditor();toast('覆盖区参数已更新，可撤销');}catch(err){toast(err.message,true);}
};
$('reference-image').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>20*1024*1024){toast('参考图片限制 20 MB',true);return;}
  if(referenceURL)URL.revokeObjectURL(referenceURL);referenceURL=URL.createObjectURL(f);$('reference-preview').src=referenceURL;
  try{await $('reference-preview').decode();$('show-reference').hidden=false;$('reference-dialog').showModal();}catch{toast('无法读取该图片',true);URL.revokeObjectURL(referenceURL);referenceURL=null;}$('reference-image').value='';
};
$('show-reference').onclick=()=>$('reference-dialog').showModal();$('close-reference').onclick=()=>$('reference-dialog').close();


for(const [button,input] of [['choose-import','import-file'],['choose-restore','restore-project'],['choose-mbtiles','import-mbtiles'],['choose-reference','reference-image']])$(button).onclick=()=>$(input).click();
$('export-format').addEventListener('change',()=>{$('export-crs-row').hidden=$('export-format').value!=='csv';});
document.querySelectorAll('[data-tab],[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('active'))));

let initializing=false;
async function initialize(){if(initializing||ready)return;initializing=true;try{
 project=await api('/api/project');packages=await api('/api/packages');restoreCRS();$('coord-to').value='EPSG:3857';$('project-name').value=project.name;source.clear();source.addFeatures(geo.readFeatures(project.features,formatOptions));map.getView().setCenter(fromLonLat(project.view?.center||[120.145,30.246]));map.getView().setZoom(project.view?.zoom||13);setBase(project.activeSource||'osm');renderObjects();renderSources();history=[snapshot()];historyIndex=0;updateUndo();ready=true;$('save-state').textContent='已保存到本机';
 const drafts=await getDrafts().catch(()=>[]);const content=contentKey;for(const d of drafts)if(content(d.payload)===content(project))await clearDraft(d.id,d.token).catch(()=>{});recoveryDraft=drafts.find(d=>content(d.payload)!==content(project))||null;
 if(recoveryDraft){notice(`发现 ${new Date(recoveryDraft.at).toLocaleString()} 的浏览器草稿（${recoveryDraft.payload.features.features.length} 个对象），尚未覆盖当前项目。`);$('recover-draft').hidden=false;}
 const health=await api('/api/health');if(health.recovery?.length)notice('已从历史备份恢复损坏或缺失的主文件，损坏文件保存在 recovery 目录。'+(recoveryDraft?'另有浏览器草稿待核对。':''));
 await refreshPackages();await refreshBackups();
 }catch(e){if(!ready)$('save-state').textContent='服务未连接 · 自动重连';else notice(e.message);}finally{initializing=false;}}
await initialize();
setInterval(()=>{if(!ready){initialize();return;}refreshPackages().catch(()=>{});},3000);
