const DATABASE = 'personal-vocab-2026';
const VERSION = 1;
const STORE = 'records';
let cachedOpen;
export function openDB() {
  if (!cachedOpen) cachedOpen = new Promise((resolve,reject) => {
    const req = indexedDB.open(DATABASE, VERSION);
    req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:'key'}); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('資料庫已被其他分頁占用，請關閉其他分頁後重試'));
  });
  return cachedOpen;
}
export async function getAll(){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function saveRecord(defaults, changes, {existingOnly = false, createOnly = false} = {}){
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(defaults.key);
    let record;
    req.onsuccess = () => {
      if (existingOnly && (!req.result || req.result.added_at !== defaults.added_at)) return;
      if (createOnly && req.result) return;
      const current = {...defaults,...req.result};
      const updates = typeof changes === 'function' ? changes(current) : changes;
      record = {...current,...updates};
      store.put(record);
    };
    tx.oncomplete = () => resolve(record);
    tx.onabort = () => reject(tx.error || new Error('資料儲存失敗'));
  });
}
export async function deleteRecord(key){
  const db = await openDB();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('資料刪除失敗'));
  });
}
export async function replaceRecords(records){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    const store=tx.objectStore(STORE);
    store.clear();
    for (const rec of records) store.put(rec);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('資料還原失敗'));
  });
}
