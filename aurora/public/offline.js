/* Aurora Music — offline storage (IndexedDB): downloaded tracks with audio + art blobs + metadata. */
'use strict';

const OfflineDB = (() => {
  const DB_NAME = 'aurora-offline';
  const DB_VERSION = 1;
  const STORE = 'tracks';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB не поддерживается')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  return {
    save(record) { return withStore('readwrite', (s) => s.put(record)); },
    get(id) { return withStore('readonly', (s) => s.get(id)); },
    has(id) { return withStore('readonly', (s) => s.get(id)).then((r) => !!r); },
    remove(id) { return withStore('readwrite', (s) => s.delete(id)); },
    list() { return withStore('readonly', (s) => s.getAll()); },
  };
})();
