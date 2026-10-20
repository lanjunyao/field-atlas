// IndexedDB survives reloads; each browser tab owns its own pending draft.
let opening;
function db(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open('field-atlas-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact(mode,work){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('drafts',mode),store=tx.objectStore('drafts');let result;work(store,v=>{result=v;});tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export const putDraft=d=>transact('readwrite',s=>{s.get(d.id).onsuccess=e=>{if(!e.target.result||e.target.result.token<=d.token)s.put(d);};});
export const getDrafts=()=>transact('readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result.sort((a,b)=>b.at-a.at));});
export const clearDraft=(id,token)=>transact('readwrite',s=>{s.get(id).onsuccess=e=>{if(e.target.result?.token===token)s.delete(id);};});
// A fresh document gets a new key so startup/view saves cannot overwrite an older recovery draft.
export const draftId=crypto.randomUUID();
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export function contentKey(p){
 // Normalize only the comparison copy: projection round trips can differ by ~1e-14 degrees.
 const geometryCopy=v=>typeof v==='number'?Number(v.toFixed(10)):Array.isArray(v)?v.map(geometryCopy):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,geometryCopy(x)])):v;
 const features=p.features.features.map(f=>({...f,geometry:geometryCopy(f.geometry)})).sort((a,b)=>String(a.id??JSON.stringify(canonical(a))).localeCompare(String(b.id??JSON.stringify(canonical(b)))));
 return JSON.stringify(canonical({name:p.name,features,sources:[...p.sources].sort((a,b)=>String(a.id).localeCompare(String(b.id))),customCRS:p.customCRS||[],activeSource:p.activeSource}));
}
