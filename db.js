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
export async function saveRecord(record){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).put(record);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
export async function deleteRecord(key){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readwrite').objectStore(STORE).delete(key);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
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
