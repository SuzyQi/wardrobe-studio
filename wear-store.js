(function(root){
  'use strict';let db;const W=root.WardrobeWear;
  function blank(){return {id:'journal',journal:W.empty(),base:null,origin:'',lastSyncAt:''};}
  function safe(s){if(!s)return blank();return {id:'journal',journal:W.validate(s.journal),base:s.base?W.validate(s.base):null,origin:typeof s.origin==='string'?s.origin:'',lastSyncAt:typeof s.lastSyncAt==='string'?s.lastSyncAt:''};}
  function open(){if(db)return Promise.resolve(db);return new Promise((resolve,reject)=>{const r=root.indexedDB.open('wardrobe-wear-journal-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'id'});r.onsuccess=()=>{db=r.result;db.onversionchange=()=>{db.close();db=null;};resolve(db);};r.onerror=()=>reject(new Error('无法打开穿着日记，本次未保存。'));r.onblocked=()=>reject(new Error('请关闭其他穿着日记标签页后重试。'));});}
  async function transaction(change){const database=await open();return new Promise((resolve,reject)=>{const tx=database.transaction('state',change?'readwrite':'readonly'),store=tx.objectStore('state'),request=store.get('journal');let result,cause;
    request.onsuccess=()=>{try{const current=safe(request.result);result=change?safe(change(current)):current;if(change)store.put(result);}catch(error){cause=error;tx.abort();}};
    request.onerror=()=>{cause=request.error;};tx.onerror=e=>{cause||=e.target?.error||tx.error;};tx.onabort=()=>reject(cause||new Error('日记保存失败，修改尚未保存。请导出备份后重试，不要清除网站数据。'));tx.oncomplete=()=>resolve(result);
  });}
  root.WardrobeWearStore={read:()=>transaction(),update:change=>transaction(change)};
})(globalThis);
