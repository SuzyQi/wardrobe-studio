(function (root) {
  'use strict';
  let database;
  const DB_NAME = 'suzy-wardrobe-studio-v1';
  function failure(cause, action) {
    const name = cause?.name || 'StorageError';
    const hint = name === 'QuotaExceededError' ? '浏览器存储空间不足。请先导出备份，不要清除网站数据。' : '浏览器本地数据库未完成' + action + '，本次修改尚未保存。';
    const error = new Error(hint + '（' + name + (cause?.message ? '：' + cause.message : '') + '）');
    error.name = name; error.cause = cause; return error;
  }
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
      let value, cause;
      req.onsuccess = () => { value = req.result; };
      req.onerror = () => { cause = req.error; };
      tx.oncomplete = () => resolve(value || []);
      tx.onerror = event => { cause ||= event?.target?.error || tx.error; };
      tx.onabort = () => reject(failure(cause || tx.error, '读取'));
    });
  }
  async function write(operations) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const names = [...new Set(operations.map(o => o.store))];
      if (!names.length) return resolve();
      const tx = db.transaction(names, 'readwrite');
      let cause;
      tx.oncomplete = () => resolve();
      // Request errors bubble before tx.error is necessarily populated in Safari.
      // Wait for abort so neither a partial write nor an early error is called success.
      tx.onerror = event => { cause ||= event?.target?.error || tx.error; };
      tx.onabort = () => reject(failure(cause || tx.error, '保存'));
      try {
        for (const op of operations) {
          const store = tx.objectStore(op.store);
          const req = op.type === 'delete' ? store.delete(op.id) : store.put(op.value);
          if (req) req.onerror = () => { cause ||= req.error; };
        }
      } catch (error) { cause = error; tx.abort(); reject(failure(error, '保存')); }
    });
  }
  root.WardrobeStorage = { open, read, write };
})(globalThis);
