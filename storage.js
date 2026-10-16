(function (root) {
  'use strict';
  let database;
  const DB_NAME = 'suzy-wardrobe-studio-v1';
  function open() {
    if (database) return Promise.resolve(database);
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('当前浏览器不支持本地衣橱。请使用新版 Chrome、Edge、Safari 或 Firefox。'));
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['garments', 'outfits', 'meta']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        database = req.result;
        database.onversionchange = () => { database.close(); database = null; };
        resolve(database);
      };
      req.onerror = () => reject(req.error || new Error('无法打开本地衣橱。'));
      req.onblocked = () => reject(new Error('请关闭其他衣橱标签页后重新打开。'));
    });
  }
  async function read(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly'), req = tx.objectStore(store).getAll();
      let value;
      req.onsuccess = () => { value = req.result; };
      tx.oncomplete = () => resolve(value || []);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('读取衣橱失败。'));
    });
  }
  async function write(operations) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const names = [...new Set(operations.map(o => o.store))];
      if (!names.length) return resolve();
      const tx = db.transaction(names, 'readwrite');
      try {
        for (const op of operations) {
          const store = tx.objectStore(op.store);
          if (op.type === 'delete') store.delete(op.id);
          else store.put(op.value);
        }
      } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('本地保存失败，请导出备份，并检查浏览器存储空间。'));
    });
  }
  root.WardrobeStorage = { open, read, write };
})(globalThis);
